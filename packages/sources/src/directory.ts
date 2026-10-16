import { realpath, stat } from 'node:fs/promises';
import { heroError } from '@hero-cloud/core';
import type { LoadOptions, ProjectSnapshot, SourceLoader, SourceRef } from '@hero-cloud/core';
import { DiskSnapshot } from './disk-snapshot.js';
import { DEFAULT_LIMITS } from './policy.js';
import type { SourceLimits } from './policy.js';
import { scanDirectory } from './scan.js';

/** Loads a local folder. The folder itself is the user's explicit choice; what is inside is not. */
export class DirectorySource implements SourceLoader {
  readonly kind = 'directory';
  readonly #limits: SourceLimits;

  constructor(limits: SourceLimits = DEFAULT_LIMITS) {
    this.#limits = limits;
  }

  async load(ref: SourceRef, options: LoadOptions = {}): Promise<ProjectSnapshot> {
    let root: string;
    try {
      root = await realpath(ref.location);
      if (!(await stat(root)).isDirectory()) throw heroError('source.not-found');
    } catch (error) {
      throw heroError('source.not-found', undefined, error);
    }
    const { files, skipped } = await scanDirectory(root, this.#limits, options.signal);
    return new DiskSnapshot(root, files, skipped);
  }
}
