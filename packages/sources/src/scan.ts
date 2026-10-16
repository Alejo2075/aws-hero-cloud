import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { heroError } from '@hero-cloud/core';
import type { SkippedEntry, SnapshotFile } from '@hero-cloud/core';
import { NO_FOLLOW } from './fs-flags.js';
import { normalizeEntryPath } from './paths.js';
import { isIgnoredDirectory, isSensitivePath } from './policy.js';
import type { SourceLimits } from './policy.js';

export interface ScanResult {
  readonly files: SnapshotFile[];
  readonly skipped: SkippedEntry[];
}

/** Hashes a file while reading it, refusing symlinks and files that change size under us. */
async function hashRegularFile(absolute: string, expectedSize: number): Promise<string> {
  const handle = await open(absolute, constants.O_RDONLY | NO_FOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== expectedSize) throw heroError('source.unsafe-path');
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
      total += bytesRead;
      if (total > expectedSize) throw heroError('source.unsafe-path');
    }
    if (total !== expectedSize) throw heroError('source.unsafe-path');
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/**
 * Walks a directory without ever following a symlink. Skips dependency and build folders, files
 * that look like secrets, and anything that is not a plain file or directory. Enforces the limits
 * as it goes, so a hostile tree cannot make Hero read without bound.
 */
export async function scanDirectory(
  root: string,
  limits: SourceLimits,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const files: SnapshotFile[] = [];
  const skipped: SkippedEntry[] = [];
  let totalBytes = 0;

  const visit = async (relative: string, depth: number): Promise<void> => {
    if (depth > limits.maxDepth) throw heroError('source.unsafe-path');
    const directory = await opendir(relative === '' ? root : join(root, ...relative.split('/')));
    try {
      for await (const entry of directory) {
        signal?.throwIfAborted();
        const path = normalizeEntryPath(
          relative === '' ? entry.name : `${relative}/${entry.name}`,
          limits,
        );

        if (entry.isSymbolicLink()) {
          skipped.push({ path, reason: 'symlink' });
        } else if (entry.isDirectory()) {
          if (isIgnoredDirectory(entry.name)) skipped.push({ path, reason: 'ignored' });
          else await visit(path, depth + 1);
        } else if (entry.isFile()) {
          if (isSensitivePath(path)) {
            skipped.push({ path, reason: 'sensitive' });
            continue;
          }
          const absolute = join(root, ...path.split('/'));
          const handle = await open(absolute, constants.O_RDONLY | NO_FOLLOW);
          const size = (await handle.stat()).size;
          await handle.close();

          if (size > limits.maxFileBytes) throw heroError('source.too-large', { path });
          totalBytes += size;
          if (totalBytes > limits.maxTotalBytes) throw heroError('source.too-large');
          if (files.length + 1 > limits.maxFiles) throw heroError('source.too-many-files');

          files.push({ path, size, sha256: await hashRegularFile(absolute, size) });
        } else {
          skipped.push({ path, reason: 'special' });
        }
      }
    } finally {
      await directory.close().catch(() => undefined);
    }
  };

  await visit('', 0);
  return { files, skipped };
}
