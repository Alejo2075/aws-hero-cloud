// Bundles the CLI and the workspace packages it uses into one runnable file.
import { chmod, cp, mkdir, readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
const outfile = new URL('../dist/hero-cloud.js', import.meta.url).pathname;

await build({
  entryPoints: [new URL('../src/bin.ts', import.meta.url).pathname],
  outfile,
  bundle: true,
  // Infrastructure libraries read their own files at run time, so they stay installed packages.
  external: ['aws-cdk-lib', 'constructs', 'cdk-nag', '@aws-cdk/toolkit-lib', '@aws-sdk/*'],
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Some bundled dependencies are CommonJS and call require().
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nimport { fileURLToPath as __fileURLToPath } from 'node:url';\nimport { dirname as __dirname_of } from 'node:path';\nconst require = __createRequire(import.meta.url);\nconst __filename = __fileURLToPath(import.meta.url);\nconst __dirname = __dirname_of(__filename);",
  },
  define: { __HERO_VERSION__: JSON.stringify(version) },
  // Smaller to download; names stay readable so an error report is still useful.
  minifyWhitespace: true,
  minifySyntax: true,
  legalComments: 'none',
  logLevel: 'warning',
});
await chmod(outfile, 0o755);

// Studio's static files travel beside the bundle, where the local server looks for them.
await import('../../studio/scripts/build.mjs');
await cp(
  new URL('../../studio/dist/', import.meta.url),
  new URL('../dist/studio/', import.meta.url),
  {
    recursive: true,
  },
);
