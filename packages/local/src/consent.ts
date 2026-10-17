import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AiConsent } from './index.js';

const SCOPES = ['file-names', 'snippets', 'full-files'] as const;

/**
 * Remembers what a person agreed to share with which AI provider, so they are asked once and can
 * see (and delete) the record. It holds no keys and no project content.
 */
export class FileAiConsentStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<AiConsent | undefined> {
    try {
      const value = JSON.parse(await readFile(this.#path, 'utf8')) as Partial<AiConsent>;
      return typeof value.provider === 'string' &&
        typeof value.grantedAt === 'string' &&
        SCOPES.includes(value.scope as (typeof SCOPES)[number])
        ? (value as AiConsent)
        : undefined;
    } catch {
      return undefined;
    }
  }

  async write(consent: AiConsent): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    const temporary = `${this.#path}.${String(process.pid)}.tmp`;
    await writeFile(temporary, JSON.stringify(consent, null, 2), { mode: 0o600 });
    await rename(temporary, this.#path);
  }
}
