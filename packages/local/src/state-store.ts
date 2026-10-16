import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { heroError } from '@hero-cloud/core';
import type { StateStore } from '@hero-cloud/core';

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Keeps deployment state as one JSON file per deployment under a folder such as `.hero/state`.
 * The AWS stack stays the source of truth: this only remembers what Hero needs to find it again.
 * Only the owner can read the folder, a write never leaves a half-written file, and an id that
 * could point outside the folder is refused.
 */
export class FileStateStore implements StateStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  #path(deploymentId: string): string {
    if (!ID.test(deploymentId)) throw heroError('plan.unknown');
    return join(this.#directory, `${deploymentId}.json`);
  }

  async read(deploymentId: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.#path(deploymentId), 'utf8')) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  async write(deploymentId: string, state: unknown): Promise<void> {
    const target = this.#path(deploymentId);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${String(process.pid)}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temporary, target);
  }

  async list(): Promise<readonly string[]> {
    try {
      return (await readdir(this.#directory))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter((id) => ID.test(id))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
