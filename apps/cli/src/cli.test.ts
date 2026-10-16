import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHero } from '@hero-cloud/sdk';
import type { AnalyzeOptions, Hero, SourceRef } from '@hero-cloud/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from './cli.js';
import type { CliIo } from './cli.js';
import { sanitizeForTerminal } from './sanitize.js';
import { wrap } from './render-text.js';

const examples = resolve(import.meta.dirname, '..', '..', '..', 'examples');
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

interface Captured {
  readonly io: CliIo;
  out(): string;
  err(): string;
}

function capture(overrides: Partial<CliIo> & { env?: Record<string, string> } = {}): Captured {
  let out = '';
  let err = '';
  const io: CliIo = {
    stdout: { write: (text) => (out += text) },
    stderr: { write: (text) => (err += text) },
    env: { LANG: 'en_US.UTF-8' },
    stdoutIsTTY: false,
    stderrIsTTY: false,
    columns: 80,
    version: '9.9.9',
    readFile: () => Promise.reject(new Error('no files')),
    resolvePath: (path) => resolve(path),
    createHero: () => createHero(),
    ...overrides,
  };
  return { io, out: () => out, err: () => err };
}

async function tempProject(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hero-cli-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text);
  return dir;
}

describe('help, version, and usage errors', () => {
  it('prints help with no arguments and with --help, in the chosen language', async () => {
    const a = capture();
    expect(await run([], a.io)).toBe(0);
    expect(a.out()).toContain('Usage:');
    const b = capture();
    expect(await run(['--help', '--locale', 'es'], b.io)).toBe(0);
    expect(b.out()).toContain('Uso:');
    expect(a.err()).toBe('');
  });

  it('prints the version', async () => {
    const c = capture();
    expect(await run(['--version'], c.io)).toBe(0);
    expect(c.out()).toBe('9.9.9\n');
  });

  it.each([
    [['deploy', 'x']],
    [['analyze']],
    [['analyze', 'a', 'b']],
    [['analyze', 'a', '--level', 'nope']],
    [['analyze', 'a', '--kind', 'ftp']],
    [['analyze', 'a', '--locale', 'not valid']],
    [['analyze', 'a', '--bogus']],
  ])('exits 2 for %j', async (argv) => {
    const c = capture();
    expect(await run(argv, c.io)).toBe(2);
    expect(c.out()).toBe('');
    expect(c.err()).toContain('hero-cloud --help');
  });

  it('explains the reason at the guided level, and honours level and language even on a bad command', async () => {
    const guided = capture();
    expect(await run(['deploy', 'x', '-l', 'guided'], guided.io)).toBe(2);
    expect(guided.err()).toContain('unknown command "deploy"');
    const spanish = capture();
    await run(['deploy', 'x', '--level=expert', '--locale=es'], spanish.io);
    expect(spanish.err()).toContain('Uso inválido: unknown command "deploy"');
    const badLevel = capture();
    await run(['analyze', 'x', '--level', 'nope', '--locale', 'es'], badLevel.io);
    expect(badLevel.err()).toContain('Hero no entendió ese comando.');
  });
});

describe('analyze', () => {
  it.each([
    ['simple', 'A website', 'hero-example-spa-api'],
    ['guided', 'very sure', 'uses the vite@^7.0.0 library'],
    ['expert', 'What Hero detected', 'http-service'],
  ])('shows the %s view', async (level, ...expected) => {
    const c = capture();
    expect(
      await run(['analyze', join(examples, 'spa-api'), '--level', level, '--no-color'], c.io),
    ).toBe(0);
    for (const text of expected) expect(c.out()).toContain(text);
    expect(c.err()).toBe('');
  });

  it('renders Spanish', async () => {
    const c = capture();
    await run(['analyze', join(examples, 'spa-api'), '--locale', 'es', '--no-color'], c.io);
    expect(c.out()).toContain('Lo que Hero entendió');
  });

  it('takes level and language from the environment, and flags win', async () => {
    const fromEnv = capture({ env: { HERO_LEVEL: 'expert', LANG: 'es_ES.UTF-8' } });
    await run(['analyze', join(examples, 'spa-api'), '--no-color'], fromEnv.io);
    expect(fromEnv.out()).toContain('Lo que Hero entendió');
    expect(fromEnv.out()).toContain('Capacidad');
    const flagWins = capture({ env: { HERO_LEVEL: 'expert', LANG: 'es_ES.UTF-8' } });
    await run(
      ['analyze', join(examples, 'spa-api'), '--no-color', '-l', 'simple', '--locale', 'en'],
      flagWins.io,
    );
    expect(flagWins.out()).toContain('What Hero understood');
    expect(flagWins.out()).not.toContain('Capability');
  });

  it('prints stable, versioned JSON to stdout and nothing to stderr', async () => {
    const c = capture({ stderrIsTTY: true });
    expect(await run(['analyze', join(examples, 'api-dynamodb'), '--json'], c.io)).toBe(0);
    const body = JSON.parse(c.out()) as {
      schema: number;
      command: string;
      analysis: { spec: { application: { name: string } } };
    };
    expect(body.schema).toBe(1);
    expect(body.command).toBe('analyze');
    expect(body.analysis.spec.application.name).toBe('orders-api');
    expect(c.err()).toBe('');
  });

  it('shows progress on stderr only for a terminal and not in JSON mode', async () => {
    const tty = capture({ stderrIsTTY: true });
    await run(['analyze', join(examples, 'spa'), '--no-color'], tty.io);
    expect(tty.err()).toContain('Reading your project...');
    const piped = capture({ stderrIsTTY: false });
    await run(['analyze', join(examples, 'spa'), '--no-color'], piped.io);
    expect(piped.err()).toBe('');
  });

  it('uses color only for a terminal, and never with NO_COLOR or --no-color', async () => {
    const tty = capture({ stdoutIsTTY: true, env: { TERM: 'xterm' } });
    await run(['analyze', join(examples, 'spa')], tty.io);
    expect(tty.out()).toContain('\u001b[1m');
    for (const extra of [{ env: { NO_COLOR: '1' } }, {}]) {
      const c = capture({ stdoutIsTTY: true, ...extra });
      await run(
        [
          'analyze',
          join(examples, 'spa'),
          ...(Object.keys(extra).length === 0 ? ['--no-color'] : []),
        ],
        c.io,
      );
      expect(c.out()).not.toContain('\u001b[');
    }
    const piped = capture();
    await run(['analyze', join(examples, 'spa')], piped.io);
    expect(piped.out()).not.toContain('\u001b[');
  });

  it('reports a missing source with a clear message, exit code 1, and nothing on stdout', async () => {
    const c = capture();
    expect(await run(['analyze', '/definitely/not/here'], c.io)).toBe(1);
    expect(c.out()).toBe('');
    expect(c.err()).toContain('could not find or open');
    const spanish = capture();
    await run(['analyze', '/definitely/not/here', '--locale', 'es'], spanish.io);
    expect(spanish.err()).toContain('no pudo encontrar o abrir');
  });

  it('reports errors as JSON on stderr in JSON mode', async () => {
    const c = capture();
    expect(await run(['analyze', '/definitely/not/here', '--json'], c.io)).toBe(1);
    expect(c.out()).toBe('');
    const body = JSON.parse(c.err()) as { error: { code: string } };
    expect(body.error.code).toBe('source.not-found');
  });

  it('hides technical detail unless HERO_DEBUG=1, and never prints the cause', async () => {
    const quiet = capture();
    await run(['analyze', '/definitely/not/here'], quiet.io);
    expect(quiet.err()).not.toContain('at ');
    const debug = capture({ env: { HERO_DEBUG: '1' } });
    await run(['analyze', '/definitely/not/here'], debug.io);
    expect(debug.err()).toContain('HeroError');
    expect(debug.err()).not.toContain('ENOENT');
  });
});

describe('routing of sources and options', () => {
  function fake(): {
    hero: Hero;
    calls: { source: SourceRef; options: AnalyzeOptions | undefined }[];
  } {
    const calls: { source: SourceRef; options: AnalyzeOptions | undefined }[] = [];
    const real = createHero();
    const hero: Hero = {
      ...real,
      subscribe: real.subscribe.bind(real),
      analyze: (source, options) => {
        calls.push({ source, options });
        return Promise.resolve({
          spec: { version: '1', application: { name: 'x' } },
          sourceHash: 'a'.repeat(64),
          detections: [],
          openQuestions: [],
          skipped: [],
          aiAssisted: false,
        });
      },
    };
    return { hero, calls };
  }

  it.each([
    ['https://github.com/acme/app.git', 'git', 'https://github.com/acme/app.git'],
    ['./app.zip', 'zip', resolve('./app.zip')],
    ['APP.ZIP', 'zip', resolve('APP.ZIP')],
    ['./folder', 'directory', resolve('./folder')],
  ])('treats %s as a %s source', async (argument, kind, location) => {
    const { hero, calls } = fake();
    const c = capture({ createHero: () => hero });
    expect(await run(['analyze', argument, '--no-color'], c.io)).toBe(0);
    expect(calls[0]?.source).toEqual({ kind, location });
  });

  it('passes root, name, and the no-ai flag through', async () => {
    const { hero, calls } = fake();
    const c = capture({ createHero: () => hero });
    await run(
      ['analyze', './x', '--root', 'apps/api', '--name', 'shop', '--no-ai', '--no-color'],
      c.io,
    );
    expect(calls[0]?.options).toMatchObject({ root: 'apps/api', name: 'shop', noAi: true });
  });

  it('lets --kind override detection', async () => {
    const { hero, calls } = fake();
    const c = capture({ createHero: () => hero });
    await run(['analyze', './thing', '--kind', 'zip', '--no-color'], c.io);
    expect(calls[0]?.source.kind).toBe('zip');
  });
});

describe('--spec', () => {
  it('uses a Hero Spec the user supplies, skipping analysis', async () => {
    const dir = await tempProject({ 'package.json': '{}' });
    const c = capture({
      readFile: () => Promise.resolve("version: '1'\napplication:\n  name: chosen\n"),
    });
    expect(await run(['analyze', dir, '--spec', 'my.yaml', '--no-color', '--json'], c.io)).toBe(0);
    const body = JSON.parse(c.out()) as {
      analysis: { spec: { application: { name: string } }; detections: unknown[] };
    };
    expect(body.analysis.spec.application.name).toBe('chosen');
    expect(body.analysis.detections).toEqual([]);
  });

  it('refuses an invalid spec and says why in the expert view', async () => {
    const dir = await tempProject({ 'package.json': '{}' });
    const c = capture({ readFile: () => Promise.resolve("version: '9'\n") });
    expect(await run(['analyze', dir, '--spec', 'bad.yaml', '-l', 'expert'], c.io)).toBe(1);
    expect(c.err()).toContain('spec.');
  });

  it('reports a spec file that cannot be read', async () => {
    const dir = await tempProject({ 'package.json': '{}' });
    const c = capture();
    expect(await run(['analyze', dir, '--spec', 'missing.yaml'], c.io)).toBe(1);
  });
});

describe('terminal safety', () => {
  it('strips escape sequences that come from the analyzed project', async () => {
    const dir = await tempProject({
      'package.json': JSON.stringify({
        name: 'evil',
        dependencies: { express: '^5\u001b]52;c;cHduZWQ=\u0007\u001b[2J' },
        scripts: { start: 'node .' },
      }),
    });
    for (const level of ['simple', 'guided', 'expert']) {
      const c = capture();
      await run(['analyze', dir, '--level', level, '--no-color'], c.io);
      expect(c.out(), level).not.toContain('\u001b');
      expect(c.out(), level).not.toContain('\u0007');
      expect(c.out(), level).not.toContain('cHduZWQ');
    }
  });

  it('keeps JSON output machine-safe', async () => {
    const dir = await tempProject({
      'package.json': JSON.stringify({
        name: 'x',
        dependencies: { express: '^5\u001b[2J' },
        scripts: { start: 'node .' },
      }),
    });
    const c = capture();
    await run(['analyze', dir, '--json'], c.io);
    expect(c.out()).not.toContain('\u001b');
    expect(() => {
      JSON.parse(c.out());
    }).not.toThrow();
  });
});

describe('sanitizeForTerminal and wrap', () => {
  it.each([
    ['\u001b[31mred', '�[31mred'],
    ['bell\u0007', 'bell�'],
    ['\u009b2J', '�2J'],
    ['rtl‮override', 'rtl�override'],
    ['line one\nline two\tindent', 'line one\nline two\tindent'],
    ['plain ünïcode ✓', 'plain ünïcode ✓'],
  ])('sanitizes %j', (input, expected) => {
    expect(sanitizeForTerminal(input)).toBe(expected);
  });

  it('wraps at word boundaries and breaks overlong words', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrap('', 10)).toEqual(['']);
  });
});

describe('plan', () => {
  const spa = join(examples, 'spa');
  const withAccount = ['plan', spa, '--account-id', '123456789012', '--offline', '--no-color'];

  it.each([
    ['simple', 'Your plan for hero-example-spa', 'Nothing is created until'],
    ['guided', 'CloudFront distribution', 'Why this approach'],
    ['expert', 'aws:cloudfront:Distribution', 'Plan digest'],
  ])('shows the %s plan', async (level, ...expected) => {
    const c = capture();
    expect(await run([...withAccount, '--level', level], c.io)).toBe(0);
    for (const text of expected) expect(c.out()).toContain(text);
    expect(c.err()).toBe('');
  });

  it('exits 3 when the plan is made but cannot be approved yet, and says why', async () => {
    const c = capture();
    expect(await run(['plan', spa, '--offline', '--no-color'], c.io)).toBe(3);
    expect(c.out()).toContain('Before this can go online');
    // The terminal wraps long lines, so compare without line breaks.
    expect(c.out().replace(/\s+/g, ' ')).toContain('only a preview');
    expect(c.err()).toBe('');
  });

  it('prints the plan as versioned JSON, including a sealed digest', async () => {
    const c = capture();
    expect(await run([...withAccount, '--json'], c.io)).toBe(0);
    const body = JSON.parse(c.out()) as {
      schema: number;
      command: string;
      plan: { digest: string; id: string; target: { accountId: string } };
    };
    expect(body).toMatchObject({ schema: 1, command: 'plan' });
    expect(body.plan.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.plan.id).toBe(`plan_${body.plan.digest.slice(0, 24)}`);
    expect(body.plan.target.accountId).toBe('123456789012');
  });

  it('produces the same digest every time', async () => {
    const digest = async (): Promise<string> => {
      const c = capture();
      await run([...withAccount, '--json'], c.io);
      return (JSON.parse(c.out()) as { plan: { digest: string } }).plan.digest;
    };
    expect(await digest()).toBe(await digest());
  });

  it('takes answers with --answer and tells you which question ids exist', async () => {
    const dir = await tempProject({
      'package.json': JSON.stringify({ name: 'api', dependencies: { express: '5' } }),
    });
    const blocked = capture();
    expect(
      await run(
        ['plan', dir, '--account-id', '123456789012', '--offline', '--no-color'],
        blocked.io,
      ),
    ).toBe(3);
    expect(blocked.out()).toContain('service.start-unknown');
    expect(blocked.out()).toContain('--answer');

    const answered = capture();
    expect(
      await run(
        [
          'plan',
          dir,
          '--account-id',
          '123456789012',
          '--offline',
          '--no-color',
          '--answer',
          'service.start-unknown=npm run serve',
        ],
        answered.io,
      ),
    ).toBe(0);
    expect(answered.out()).not.toContain('Before this can go online');
  });

  it('refuses a malformed or repeated --answer as a usage error', async () => {
    for (const answer of [
      ['--answer', 'noequals'],
      ['--answer', '=x'],
      ['--answer', 'Bad Id=x'],
      ['--answer', 'a=1', '--answer', 'a=2'],
    ]) {
      const c = capture();
      expect(await run(['plan', spa, ...answer], c.io)).toBe(2);
    }
  });

  it('refuses an answer to a question that does not exist, with a clear message', async () => {
    const c = capture();
    expect(await run([...withAccount, '--answer', 'nope=1'], c.io)).toBe(1);
    expect(c.err()).toContain('answers you gave is not valid');
  });

  it('refuses a bad account or region', async () => {
    for (const extra of [
      ['--account-id', 'abc'],
      ['--region', '../x'],
    ]) {
      const c = capture();
      expect(await run(['plan', spa, '--offline', ...extra], c.io)).toBe(1);
    }
  });

  it('passes --offline to the engine, and asks for the network otherwise', async () => {
    const seen: (boolean | undefined)[] = [];
    const real = createHero();
    const hero: Hero = {
      ...real,
      subscribe: real.subscribe.bind(real),
      analyze: real.analyze.bind(real),
      // Record what the CLI asked for, but never let a test reach the network.
      plan: (analysis, options) => {
        seen.push(options?.offline);
        return real.plan(analysis, { ...options, offline: true });
      },
    };
    await run(
      ['plan', spa, '--account-id', '123456789012', '--offline'],
      capture({ createHero: () => hero }).io,
    );
    await run(
      ['plan', spa, '--account-id', '123456789012'],
      capture({ createHero: () => hero }).io,
    );
    expect(seen).toEqual([true, false]);
  });

  it('renders Spanish', async () => {
    const c = capture();
    await run([...withAccount, '--locale', 'es'], c.io);
    expect(c.out()).toContain('Tu plan para hero-example-spa');
  });
});
