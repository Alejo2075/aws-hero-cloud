import { constants } from 'node:fs';
import { NO_FOLLOW } from './fs-flags.js';
import { lstat, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { computeSnapshotHash, heroError } from '@hero-cloud/core';
import type { ProjectSnapshot, SkippedEntry, SnapshotFile } from '@hero-cloud/core';
import { digestsEqual, sha256Hex } from '@hero-cloud/shared';

/** Compares paths by UTF-16 code units, the same order everywhere. */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A snapshot backed by files on disk. Every read re-checks the file against the hash taken at load
 * time, so content that changed (or was swapped for a symlink) after loading is refused.
 */
export class DiskSnapshot implements ProjectSnapshot {
  readonly hash: string;
  readonly files: readonly SnapshotFile[];
  readonly skipped: readonly SkippedEntry[];
  readonly #root: string;
  readonly #index: ReadonlyMap<string, SnapshotFile>;
  readonly #cleanup: (() => Promise<void>) | undefined;
  #disposed = false;

  constructor(
    root: string,
    files: readonly SnapshotFile[],
    skipped: readonly SkippedEntry[],
    cleanup?: () => Promise<void>,
  ) {
    this.#root = root;
    this.files = [...files].sort((a, b) => comparePaths(a.path, b.path));
    this.skipped = [...skipped].sort((a, b) => comparePaths(a.path, b.path));
    this.#index = new Map(this.files.map((file) => [file.path, file]));
    this.hash = computeSnapshotHash(this.files);
    this.#cleanup = cleanup;
  }

  async read(path: string): Promise<Uint8Array> {
    const entry = this.#index.get(path);
    if (entry === undefined) throw heroError('source.unsafe-path');
    if (this.#disposed) throw heroError('source.not-found');

    const absolute = join(this.#root, ...path.split('/'));
    const stats = await lstat(absolute);
    if (!stats.isFile()) throw heroError('source.unsafe-path');

    const handle = await open(absolute, constants.O_RDONLY | NO_FOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size !== entry.size) throw heroError('source.unsafe-path');
      const buffer = Buffer.alloc(entry.size);
      let offset = 0;
      while (offset < entry.size) {
        const { bytesRead } = await handle.read(buffer, offset, entry.size - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== entry.size || !digestsEqual(sha256Hex(buffer), entry.sha256)) {
        throw heroError('source.unsafe-path');
      }
      return buffer;
    } finally {
      await handle.close();
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.#cleanup?.();
  }
}

/** Removes a temporary directory, ignoring errors (best effort cleanup). */
export function removeDirectory(path: string): () => Promise<void> {
  return async () => {
    await rm(path, { recursive: true, force: true });
  };
}
