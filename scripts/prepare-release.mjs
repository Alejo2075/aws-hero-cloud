// Writes the files that make the workspace packages publishable, from each package.json:
//   - tsconfig.build.json (a composite project that references the packages it depends on)
//   - the root tsconfig.build.json that builds them all in dependency order
//   - `files`, `publishConfig` (dist exports, public access, provenance) in each package.json
// Run it after adding or changing a published package: `node scripts/prepare-release.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PUBLISHED } from './release-packages.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const byName = new Map(PUBLISHED.map((dir) => [read(join(root, dir, 'package.json')).name, dir]));

for (const dir of PUBLISHED) {
  const manifestPath = join(root, dir, 'package.json');
  const manifest = read(manifestPath);
  const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter((name) => byName.has(name))
    .sort();
  write(join(root, dir, 'tsconfig.build.json'), {
    extends: relative(join(root, dir), join(root, 'tsconfig.base.json')),
    compilerOptions: {
      composite: true,
      rootDir: 'src',
      outDir: 'dist',
      noEmit: false,
      sourceMap: false,
      tsBuildInfoFile: 'dist/.tsbuildinfo',
      types: ['node'],
    },
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.test.ts'],
    references: deps.map((name) => ({
      path: relative(join(root, dir), join(root, byName.get(name), 'tsconfig.build.json')),
    })),
  });

  // Source-first for development, compiled for the people who install it.
  const sourceExports = manifest.exports;
  const distExports = Object.fromEntries(
    Object.entries(sourceExports).map(([key, value]) => {
      const target = String(value)
        .replace(/^\.\/src\//, './dist/')
        .replace(/\.ts$/, '');
      return [key, { types: `${target}.d.ts`, import: `${target}.js` }];
    }),
  );
  const next = { ...manifest };
  delete next.private;
  next.files = ['dist', 'README.md', ...(dir === 'packages/specification' ? ['schema'] : [])];
  next.publishConfig = { access: 'public', provenance: true, exports: distExports };
  const rootExport = distExports['.'];
  if (rootExport !== undefined) next.publishConfig.types = rootExport.types.replace('./', '');
  write(manifestPath, next);
}

write(join(root, 'tsconfig.build.json'), {
  files: [],
  references: PUBLISHED.map((dir) => ({ path: `./${dir}/tsconfig.build.json` })),
});
