import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from '@hero-cloud/cli';
import type { CliIo } from '@hero-cloud/cli';
import { createHero } from '@hero-cloud/sdk';
import type { Hero } from '@hero-cloud/sdk';
import { afterEach, describe, expect, it } from 'vitest';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

async function flask() {
  const dir = await mkdtemp(join(tmpdir(), 'hero-cli-ai-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'requirements.txt'), 'flask\n');
  await writeFile(join(dir, 'app.py'), 'app.run(port=5000)\n');
  return dir;
}

function terminal(
  answers: string[] = [],
  interactive = answers.length > 0,
  env: Record<string, string> = {},
) {
  let out = '';
  let err = '';
  const settingsSeen: { ai?: unknown }[] = [];
  const records: { path: string; record?: unknown }[] = [];
  let stored:
    | { provider: string; scope: 'file-names' | 'snippets' | 'full-files'; grantedAt: string }
    | undefined;
  const io: CliIo = {
    stdout: { write: (t) => (out += t) },
    stderr: { write: (t) => (err += t) },
    env: { LANG: 'en_US.UTF-8', ...env },
    stdoutIsTTY: false,
    stderrIsTTY: false,
    columns: 80,
    version: '0.0.0',
    readFile: () => Promise.reject(new Error('no')),
    resolvePath: (p) => resolve(p),
    stdinIsTTY: interactive,
    ask: () => Promise.resolve(answers.shift() ?? ''),
    openConsent: (path) => ({
      read: () => Promise.resolve(stored),
      write: (record) => {
        stored = record;
        records.push({ path, record });
        return Promise.resolve();
      },
    }),
    createHero: (settings): Hero => {
      settingsSeen.push({ ai: settings?.ai });
      return createHero({
        ...(settings?.ai === undefined
          ? {}
          : { ai: settings.ai.provider, aiConsent: { scope: settings.ai.scope } }),
      });
    },
  };
  return { io, out: () => out, err: () => err, settingsSeen, records, stored: () => stored };
}

describe('--ai', () => {
  it('needs a model and a key in the environment, and never takes the key on the command line', async () => {
    const dir = await flask();
    const noModel = terminal([], false, { ANTHROPIC_API_KEY: 'k' });
    expect(await run(['analyze', dir, '--ai', 'anthropic'], noModel.io)).toBe(2);
    const noKey = terminal();
    expect(
      await run(
        ['analyze', dir, '--ai', 'anthropic', '--ai-model', 'm', '--level', 'guided'],
        noKey.io,
      ),
    ).toBe(2);
    expect(noKey.err()).toContain('ANTHROPIC_API_KEY');
    const literalKey = terminal();
    expect(
      await run(
        [
          'analyze',
          dir,
          '--ai',
          'anthropic',
          '--ai-model',
          'm',
          '--ai-key-env',
          'sk-ant-literal-key',
        ],
        literalKey.io,
      ),
    ).toBe(2);
    expect(literalKey.err()).not.toContain('sk-ant-literal-key');
    expect(await run(['analyze', dir, '--ai', 'skynet'], terminal().io)).toBe(2);
    expect(await run(['analyze', dir, '--ai-scope', 'everything'], terminal().io)).toBe(2);
  });

  it('asks before sending anything to a remote model, says to whom and what, and remembers a yes', async () => {
    const dir = await flask();
    const t = terminal(['y'], true, { ANTHROPIC_API_KEY: 'k' });
    await run(['analyze', dir, '--ai', 'anthropic', '--ai-model', 'm'], t.io);
    expect(t.settingsSeen[0]?.ai).toBeDefined();
    expect(t.records[0]?.record).toMatchObject({
      provider: expect.stringContaining('anthropic') as string,
      scope: 'snippets',
    });
    expect(t.records[0]?.path).toMatch(/ai-consent\.json$/);
    expect(JSON.stringify(t.records)).not.toContain('"k"');

    // Remembered: the second run does not ask.
    const again = await run(['analyze', dir, '--ai', 'anthropic', '--ai-model', 'm'], {
      ...t.io,
      ask: () => Promise.reject(new Error('must not ask again')),
    });
    expect(again).toBe(0);
  });

  it('continues without the model, and says so, when the person does not agree', async () => {
    const dir = await flask();
    const t = terminal(['n'], true, { OPENAI_API_KEY: 'k' });
    expect(await run(['analyze', dir, '--ai', 'openai', '--ai-model', 'm'], t.io)).toBe(0);
    expect(t.settingsSeen[0]?.ai).toBeUndefined();
    expect(t.err()).toContain('you did not agree');
    expect(t.stored()).toBeUndefined();
  });

  it('a script must say what it shares: no scope and no person means no model', async () => {
    const dir = await flask();
    const silent = terminal([], false, { OPENAI_API_KEY: 'k' });
    expect(await run(['analyze', dir, '--ai', 'openai', '--ai-model', 'm'], silent.io)).toBe(0);
    expect(silent.settingsSeen[0]?.ai).toBeUndefined();
    const explicit = terminal([], false, { OPENAI_API_KEY: 'k' });
    expect(
      await run(
        ['analyze', dir, '--ai', 'openai', '--ai-model', 'm', '--ai-scope', 'file-names'],
        explicit.io,
      ),
    ).toBe(0);
    expect(explicit.settingsSeen[0]?.ai).toMatchObject({ scope: 'file-names' });
    expect(explicit.stored()?.scope).toBe('file-names');
  });

  it('a model on this computer needs no consent and no key', async () => {
    const dir = await flask();
    const t = terminal();
    expect(await run(['analyze', dir, '--ai', 'ollama', '--ai-model', 'llama3'], t.io)).toBe(0);
    expect(t.settingsSeen[0]?.ai).toBeDefined();
    expect(t.records).toEqual([]);
  });

  it('--no-ai wins over everything', async () => {
    const dir = await flask();
    const t = terminal(['y'], true, { ANTHROPIC_API_KEY: 'k' });
    await run(['analyze', dir, '--ai', 'anthropic', '--ai-model', 'm', '--no-ai'], t.io);
    expect(t.settingsSeen[0]?.ai).toBeUndefined();
    expect(t.records).toEqual([]);
  });
});
