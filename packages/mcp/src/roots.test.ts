import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRootGuard } from './roots.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function layout() {
  const base = await mkdtemp(join(tmpdir(), 'hero-roots-'));
  dirs.push(base);
  await mkdir(join(base, 'allowed', 'app'), { recursive: true });
  await mkdir(join(base, 'secret-stuff'), { recursive: true });
  await writeFile(join(base, 'allowed', 'bundle.zip'), 'zip');
  await writeFile(join(base, 'allowed', 'notes.txt'), 'x');
  return base;
}

describe('createRootGuard', () => {
  it('accepts folders and ZIPs inside an allowed root, and the root itself', async () => {
    const base = await layout();
    const guard = await createRootGuard([join(base, 'allowed')]);
    expect((await guard.resolve(join(base, 'allowed', 'app'))).kind).toBe('directory');
    expect((await guard.resolve(join(base, 'allowed', 'bundle.zip'))).kind).toBe('zip');
    expect((await guard.resolve(join(base, 'allowed'))).kind).toBe('directory');
  });

  it('refuses everything outside, including ../ tricks and sibling names that share a prefix', async () => {
    const base = await layout();
    await mkdir(join(base, 'allowed-evil'));
    const guard = await createRootGuard([join(base, 'allowed')]);
    for (const bad of [
      join(base, 'secret-stuff'),
      join(base, 'allowed', '..', 'secret-stuff'),
      join(base, 'allowed-evil'),
      '/',
      '/etc',
    ]) {
      await expect(guard.resolve(bad), bad).rejects.toMatchObject({ code: 'source.unsafe-path' });
    }
  });

  it('follows symbolic links before deciding, so a link cannot lead out', async () => {
    const base = await layout();
    await symlink(join(base, 'secret-stuff'), join(base, 'allowed', 'link'));
    const guard = await createRootGuard([join(base, 'allowed')]);
    await expect(guard.resolve(join(base, 'allowed', 'link'))).rejects.toMatchObject({
      code: 'source.unsafe-path',
    });
  });

  it('refuses remote addresses, plain files, and missing paths, with the right error', async () => {
    const base = await layout();
    const guard = await createRootGuard([join(base, 'allowed')]);
    await expect(guard.resolve('https://github.com/x/y')).rejects.toMatchObject({
      code: 'source.unsafe-path',
    });
    await expect(guard.resolve(join(base, 'allowed', 'notes.txt'))).rejects.toMatchObject({
      code: 'source.unsafe-path',
    });
    await expect(guard.resolve(join(base, 'allowed', 'nope'))).rejects.toMatchObject({
      code: 'source.not-found',
    });
  });

  it('with no usable root allows nothing', async () => {
    const guard = await createRootGuard(['/definitely/not/here']);
    expect(guard.roots).toEqual([]);
    await expect(guard.resolve(process.cwd())).rejects.toMatchObject({
      code: 'source.unsafe-path',
    });
  });
});
