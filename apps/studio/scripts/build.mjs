// Bundles Studio into the static files the local server hands to the browser: app.js, app.css,
// and index.html. esbuild bundles the scripts and the components' own stylesheets; Tailwind turns
// the utility classes the components use into CSS; the two stylesheets are joined into app.css.
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { build } from 'esbuild';

const run = promisify(execFile);
const here = (path) => new URL(path, import.meta.url).pathname;
const out = here('../dist/');
await mkdir(out, { recursive: true });

await build({
  entryPoints: [here('../src/main.tsx')],
  outfile: `${out}app.js`,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  alias: { '@': here('../src') },
  // The page may load nothing from elsewhere, so the pixel font travels inside the stylesheet.
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});

await run(here('../node_modules/.bin/tailwindcss'), [
  '-i',
  here('../src/tailwind.css'),
  '-o',
  `${out}tailwind.css`,
  '--minify',
]);
const utilities = await readFile(`${out}tailwind.css`, 'utf8');
const components = await readFile(`${out}app.css`, 'utf8');
await writeFile(`${out}app.css`, `${utilities}\n${components}`);
await rm(`${out}tailwind.css`);
await copyFile(here('../static/index.html'), `${out}index.html`);
