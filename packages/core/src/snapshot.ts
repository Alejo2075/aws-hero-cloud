import { canonicalJson, sha256Hex } from '@hero-cloud/shared';
import type { SnapshotFile } from './ports.js';

/**
 * The hash of a snapshot depends only on its content: the sorted list of (path, size, sha256).
 * Where the files came from (a folder, a ZIP, a Git checkout) does not matter.
 */
export function computeSnapshotHash(files: readonly SnapshotFile[]): string {
  const sorted = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ path, size, sha256 }) => ({ path, size, sha256 }));
  return sha256Hex(canonicalJson(sorted));
}
