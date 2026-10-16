import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { HeroError } from '@hero-cloud/sdk';

/**
 * Keeps an AI assistant from pointing Hero at folders it was not given. Only folders (and ZIP
 * files) inside the roots a person chose are accepted, after symbolic links are resolved, so a link
 * inside an allowed folder cannot lead out of it. Remote addresses are never accepted here.
 */
export interface RootGuard {
  /** The real path of a source, or a coded error when it is outside the allowed roots. */
  resolve(path: string): Promise<{ readonly location: string; readonly kind: 'directory' | 'zip' }>;
  readonly roots: readonly string[];
}

const inside = (root: string, target: string): boolean => {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
};

export async function createRootGuard(allowed: readonly string[]): Promise<RootGuard> {
  const roots: string[] = [];
  for (const root of allowed) {
    try {
      roots.push(await realpath(resolve(root)));
    } catch {
      // A root that does not exist allows nothing.
    }
  }
  return {
    roots,
    async resolve(path) {
      const refuse = (reason: string): HeroError =>
        new HeroError('source.unsafe-path', { params: { reason } });
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.includes('\0')) throw refuse('not-local');
      let real: string;
      try {
        real = await realpath(resolve(path));
      } catch {
        throw new HeroError('source.not-found');
      }
      if (!roots.some((root) => inside(root, real))) throw refuse('outside-allowed-roots');
      const info = await stat(real);
      if (info.isDirectory()) return { location: real, kind: 'directory' };
      if (info.isFile() && /\.zip$/i.test(real)) return { location: real, kind: 'zip' };
      throw refuse('not-a-project');
    },
  };
}
