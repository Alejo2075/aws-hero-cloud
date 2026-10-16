import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileDeploymentLock } from './lock.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'hero-lock-'));
  dirs.push(dir);
  return dir;
}

describe('FileDeploymentLock', () => {
  it('lets one holder in at a time, and the next in after release', async () => {
    const dir = await folder();
    const lock = new FileDeploymentLock(dir);
    const release = await lock.acquire('hero-a');
    await expect(new FileDeploymentLock(dir).acquire('hero-a')).rejects.toMatchObject({
      code: 'deployment.locked',
    });
    // A different deployment is not blocked.
    await (
      await lock.acquire('hero-b')
    )();
    await release();
    expect(await readdir(dir)).toEqual([]);
    await (
      await lock.acquire('hero-a')
    )();
  });

  it('takes over a lock left by a process that is gone, or one that is too old', async () => {
    const dir = await folder();
    await writeFile(
      join(dir, 'hero-a.lock'),
      JSON.stringify({ pid: 999999, token: 't', at: Date.now() }),
    );
    const dead = new FileDeploymentLock(dir, { isAlive: () => false });
    await (
      await dead.acquire('hero-a')
    )();

    await writeFile(
      join(dir, 'hero-a.lock'),
      JSON.stringify({ pid: process.pid, token: 't', at: 1000 }),
    );
    const old = new FileDeploymentLock(dir, { now: () => 1000 + 10_000, maxAgeMs: 5_000 });
    await (
      await old.acquire('hero-a')
    )();

    await writeFile(join(dir, 'hero-a.lock'), '{garbage');
    await (
      await new FileDeploymentLock(dir).acquire('hero-a')
    )();
  });

  it('does not take a lock from a live process that is still within its time', async () => {
    const dir = await folder();
    await writeFile(
      join(dir, 'hero-a.lock'),
      JSON.stringify({ pid: process.pid, token: 't', at: Date.now() }),
    );
    await expect(new FileDeploymentLock(dir).acquire('hero-a')).rejects.toMatchObject({
      code: 'deployment.locked',
    });
  });

  it('never removes a lock that has since been taken by someone else', async () => {
    const dir = await folder();
    const lock = new FileDeploymentLock(dir);
    const release = await lock.acquire('hero-a');
    await writeFile(
      join(dir, 'hero-a.lock'),
      JSON.stringify({ pid: process.pid, token: 'someone-else', at: Date.now() }),
    );
    await release();
    expect(await readdir(dir)).toEqual(['hero-a.lock']);
  });

  it('refuses ids that could leave the folder', async () => {
    const lock = new FileDeploymentLock(await folder());
    for (const bad of ['../x', 'a/b', '', 'A']) {
      await expect(lock.acquire(bad)).rejects.toMatchObject({ code: 'plan.unknown' });
    }
  });
});
