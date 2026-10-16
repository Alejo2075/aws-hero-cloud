import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const examples = join(root, 'examples');

let directory = '';
let binary = '';

/** Runs the real bundled binary as a separate process, the way a person would. */
async function hero(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('node', [binary, ...args], {
      cwd: root,
      env: { PATH: process.env.PATH ?? '', NO_COLOR: '1', LANG: 'en_US.UTF-8' },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hero-e2e-'));
  binary = join(directory, 'hero-cloud.js');
  const manifest = JSON.parse(
    await readFile(join(root, 'apps', 'cli', 'package.json'), 'utf8'),
  ) as { version: string };
  await build({
    entryPoints: [join(root, 'apps', 'cli', 'src', 'bin.ts')],
    outfile: binary,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
    },
    define: { __HERO_VERSION__: JSON.stringify(manifest.version) },
    logLevel: 'silent',
  });
}, 60_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('the hero-cloud binary', () => {
  it('has a shebang and reports its version', async () => {
    const result = await hero('--version');
    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('analyzes every example at every level in both languages', async () => {
    for (const example of [
      'static-site',
      'spa',
      'spa-api',
      'api-only',
      'api-dynamodb',
      'scheduled-job',
    ]) {
      for (const level of ['simple', 'guided', 'expert']) {
        for (const locale of ['en', 'es']) {
          const result = await hero(
            'analyze',
            join(examples, example),
            '--level',
            level,
            '--locale',
            locale,
          );
          expect(result.code, `${example} ${level} ${locale}: ${result.stderr}`).toBe(0);
          expect(result.stdout.length).toBeGreaterThan(80);
          expect(result.stderr).toBe('');
          // A message code leaking through means a missing translation.
          expect(result.stdout, `${example} ${level} ${locale}`).not.toMatch(
            /\b(?:view|component|capability|question|evidence|column)\.[a-z]/,
          );
        }
      }
    }
  }, 120_000);

  it('emits JSON that matches the SDK result', async () => {
    const result = await hero('analyze', join(examples, 'api-dynamodb'), '--json');
    const body = JSON.parse(result.stdout) as {
      schema: number;
      analysis: { spec: { data: { type: string }[] } };
    };
    expect(body.schema).toBe(1);
    expect(body.analysis.spec.data[0]?.type).toBe('key-value');
  });

  it('exits with 1 for a failure and 2 for a mistake, and sends errors to stderr', async () => {
    const missing = await hero('analyze', '/definitely/not/here');
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain('could not find or open');
    const mistake = await hero('analyze');
    expect(mistake.code).toBe(2);
    expect(mistake.stderr).toContain('--help');
  });

  it('never runs the project: lifecycle scripts, build scripts, and code stay unexecuted', async () => {
    const project = await mkdtemp(join(tmpdir(), 'hero-hostile-'));
    const marker = join(project, 'EXECUTED');
    const touch = `node -e "require('fs').writeFileSync('${marker}','x')"`;
    try {
      await writeFile(
        join(project, 'package.json'),
        JSON.stringify({
          name: 'hostile',
          main: 'index.js',
          scripts: {
            preinstall: touch,
            install: touch,
            postinstall: touch,
            prepare: touch,
            build: touch,
            start: touch,
          },
          dependencies: { express: '5' },
        }),
      );
      await writeFile(
        join(project, 'index.js'),
        `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); app.listen(3000);`,
      );
      await writeFile(
        join(project, 'vite.config.js'),
        `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');`,
      );
      const result = await hero('analyze', project, '--level', 'expert');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('http-service');
      expect(existsSync(marker)).toBe(false);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
