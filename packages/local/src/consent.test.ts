import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileAiConsentStore } from './consent.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('FileAiConsentStore', () => {
  it('remembers a decision privately and returns it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hero-consent-'));
    dirs.push(dir);
    const path = join(dir, '.hero', 'ai-consent.json');
    const store = new FileAiConsentStore(path);
    expect(await store.read()).toBeUndefined();
    const consent = {
      provider: 'anthropic',
      scope: 'snippets',
      grantedAt: '2026-01-01T00:00:00.000Z',
    } as const;
    await store.write(consent);
    expect(await store.read()).toEqual(consent);
    expect((await stat(path)).mode & 0o077).toBe(0);
  });

  it('treats a damaged or odd file as no consent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hero-consent-'));
    dirs.push(dir);
    const path = join(dir, 'c.json');
    const store = new FileAiConsentStore(path);
    for (const bad of [
      '{broken',
      '{"provider":"x","scope":"everything","grantedAt":"t"}',
      '[]',
      '{}',
    ]) {
      await writeFile(path, bad);
      expect(await store.read()).toBeUndefined();
    }
  });
});
