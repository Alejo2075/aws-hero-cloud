import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { heroError } from '@hero-cloud/core';
import type { DeploymentLock } from '@hero-cloud/core';

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DEFAULT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

interface LockFile {
  readonly pid: number;
  readonly token: string;
  readonly at: number;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface FileLockOptions {
  /** A lock older than this is treated as abandoned. Defaults to two hours. */
  readonly maxAgeMs?: number;
  readonly now?: () => number;
  readonly isAlive?: (pid: number) => boolean;
}

/**
 * A lock on a deployment that works across processes on one machine, so the CLI and a local server
 * cannot change the same deployment at once. It is a file created exclusively; a lock left behind
 * by a process that died, or that is too old, is taken over.
 */
export class FileDeploymentLock implements DeploymentLock {
  readonly #directory: string;
  readonly #maxAge: number;
  readonly #now: () => number;
  readonly #alive: (pid: number) => boolean;

  constructor(directory: string, options: FileLockOptions = {}) {
    this.#directory = directory;
    this.#maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#alive = options.isAlive ?? processIsAlive;
  }

  async acquire(deploymentId: string): Promise<() => Promise<void>> {
    if (!ID.test(deploymentId)) throw heroError('plan.unknown');
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const path = join(this.#directory, `${deploymentId}.lock`);
    const mine: LockFile = {
      pid: process.pid,
      token: randomBytes(16).toString('hex'),
      at: this.#now(),
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(path, JSON.stringify(mine), { flag: 'wx', mode: 0o600 });
        return async () => {
          // Only remove the lock if it is still ours.
          const current = await this.#read(path);
          if (current?.token === mine.token) await rm(path, { force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const held = await this.#read(path);
      const abandoned =
        held === undefined || !this.#alive(held.pid) || this.#now() - held.at > this.#maxAge;
      if (!abandoned) break;
      await rm(path, { force: true });
    }
    throw heroError('deployment.locked');
  }

  async #read(path: string): Promise<LockFile | undefined> {
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as Partial<LockFile>;
      return typeof value.pid === 'number' &&
        typeof value.token === 'string' &&
        typeof value.at === 'number'
        ? (value as LockFile)
        : undefined;
    } catch {
      return undefined;
    }
  }
}
