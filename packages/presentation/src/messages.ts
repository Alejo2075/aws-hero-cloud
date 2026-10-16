import type { AudienceLevel } from './audience.js';
import type { Message, MessageCatalog, MessageParams } from './types.js';

const LEVELS_DEEP_TO_SHALLOW: readonly AudienceLevel[] = ['expert', 'guided', 'simple'];

/** Locale lookup order: `es-MX`, then `es`, then the default locale. */
export function localeChain(locale: string, fallback: string): string[] {
  const normalized = locale.replace('_', '-');
  const language = normalized.split('-')[0] ?? normalized;
  return [...new Set([normalized, language, fallback])].filter((entry) => entry !== '');
}

function pickLevel(message: Message, level: AudienceLevel): string {
  if (typeof message === 'string') return message;
  return message[level];
}

/** Replaces `{name}` with the parameter of that name. Unknown names are left visible. */
export function interpolate(template: string, params: MessageParams = {}): string {
  return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** Names of the `{placeholders}` used by a template. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((match) => match[1] ?? '');
}

export class Messages {
  readonly #catalogs: ReadonlyMap<string, MessageCatalog>;
  readonly #fallback: string;

  constructor(catalogs: readonly MessageCatalog[], fallbackLocale = 'en') {
    this.#catalogs = new Map(catalogs.map((catalog) => [catalog.locale, catalog]));
    this.#fallback = fallbackLocale;
  }

  /** The message for a code at a level, or `undefined` when no locale has it. */
  find(
    code: string,
    level: AudienceLevel,
    locale: string,
    params?: MessageParams,
  ): string | undefined {
    for (const candidate of localeChain(locale, this.#fallback)) {
      const message = this.#catalogs.get(candidate)?.messages[code];
      if (message !== undefined) return interpolate(pickLevel(message, level), params);
    }
    return undefined;
  }

  /**
   * The message for a code, or the code itself when nothing is found, so a missing message is
   * visible and never silently empty. Experts see the code and parameters alongside.
   */
  text(code: string, level: AudienceLevel, locale: string, params?: MessageParams): string {
    return this.find(code, level, locale, params) ?? code;
  }

  has(code: string, locale: string): boolean {
    return this.#catalogs.get(locale)?.messages[code] !== undefined;
  }

  levelsOf(code: string, locale: string): readonly AudienceLevel[] | 'all' | undefined {
    const message = this.#catalogs.get(locale)?.messages[code];
    if (message === undefined) return undefined;
    return typeof message === 'string'
      ? 'all'
      : LEVELS_DEEP_TO_SHALLOW.filter((level) => level in message);
  }

  get locales(): string[] {
    return [...this.#catalogs.keys()];
  }
}
