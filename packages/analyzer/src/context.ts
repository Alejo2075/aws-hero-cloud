import { heroError } from '@hero-cloud/core';
import type { ProjectSnapshot, SnapshotFile } from '@hero-cloud/core';
import type { DetectionContext } from '@hero-cloud/plugin-sdk';

const DEFAULT_MAX_BYTES = 512 * 1024;

function normalizeRoot(root: string | undefined): string {
  if (root === undefined || root === '' || root === '.') return '';
  const trimmed = root.replace(/\/+$/, '');
  if (trimmed.startsWith('/') || trimmed.split('/').some((part) => part === '..' || part === '')) {
    throw heroError('source.unsafe-path');
  }
  return trimmed;
}

/**
 * Gives detectors a read-only view of a snapshot, optionally scoped to a sub-folder so a monorepo
 * package can be analyzed on its own. Detectors can only read files that are in the snapshot, and
 * secret-looking files never are.
 */
export function createDetectionContext(snapshot: ProjectSnapshot, root?: string): DetectionContext {
  const scope = normalizeRoot(root);
  const prefix = scope === '' ? '' : `${scope}/`;
  const files: SnapshotFile[] = snapshot.files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
  const index = new Map(files.map((file) => [file.path, file]));
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const readText = async (
    path: string,
    maxBytes = DEFAULT_MAX_BYTES,
  ): Promise<string | undefined> => {
    const entry = index.get(path);
    if (entry === undefined || entry.size > maxBytes) return undefined;
    try {
      return decoder.decode(await snapshot.read(`${prefix}${path}`));
    } catch {
      return undefined;
    }
  };

  return {
    files,
    has: (path) => index.has(path),
    list: (folder = '') => {
      const wanted = folder === '' || folder.endsWith('/') ? folder : `${folder}/`;
      return files.filter((file) => file.path.startsWith(wanted)).map((file) => file.path);
    },
    readText,
    readJson: async (path) => {
      const text = await readText(path);
      if (text === undefined) return undefined;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    },
  };
}
