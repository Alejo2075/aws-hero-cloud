import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStateStore } from './state-store.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function store() {
  const root = await mkdtemp(join(tmpdir(), 'hero-state-'));
  dirs.push(root);
  const directory = join(root, '.hero', 'state');
  return { directory, store: new FileStateStore(directory) };
}

describe('FileStateStore', () => {
  it('stores and returns state, and lists deployments in order', async () => {
    const { store: s } = await store();
    expect(await s.read('hero-a')).toBeUndefined();
    expect(await s.list()).toEqual([]);
    await s.write('hero-b', { n: 2 });
    await s.write('hero-a', { n: 1, nested: { ok: true } });
    expect(await s.read('hero-a')).toEqual({ n: 1, nested: { ok: true } });
    expect(await s.list()).toEqual(['hero-a', 'hero-b']);
    await s.write('hero-a', { n: 3 });
    expect(await s.read('hero-a')).toEqual({ n: 3 });
  });

  it('keeps the folder and files private to the owner', async () => {
    const { directory, store: s } = await store();
    await s.write('hero-a', {});
    expect((await stat(directory)).mode & 0o077).toBe(0);
    expect((await stat(join(directory, 'hero-a.json'))).mode & 0o077).toBe(0);
  });

  it('refuses ids that could leave the folder', async () => {
    const { store: s } = await store();
    for (const bad of ['../x', 'a/b', '', 'A', '.hidden', 'x'.repeat(80), 'a\0b']) {
      await expect(s.write(bad, {})).rejects.toMatchObject({ code: 'plan.unknown' });
      await expect(s.read(bad)).rejects.toMatchObject({ code: 'plan.unknown' });
    }
  });

  it('treats a damaged file as nothing stored, and leaves no temporary files behind', async () => {
    const { directory, store: s } = await store();
    await s.write('hero-a', { ok: 1 });
    await writeFile(join(directory, 'hero-a.json'), '{not json');
    expect(await s.read('hero-a')).toBeUndefined();
    await s.write('hero-a', { ok: 2 });
    expect(JSON.parse(await readFile(join(directory, 'hero-a.json'), 'utf8'))).toEqual({ ok: 2 });
    expect(await s.list()).toEqual(['hero-a']);
  });
});
