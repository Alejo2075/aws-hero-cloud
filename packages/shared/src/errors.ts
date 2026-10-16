export type ErrorParams = Readonly<Record<string, string | number | boolean>>;

/**
 * The one error type the engine throws on purpose. It carries a stable machine-readable `code` and
 * parameters, never free text: wording belongs to the presentation layer. The `cause` is kept for
 * diagnostics but is never serialized, because it may contain secrets or source text.
 */
export class HeroError extends Error {
  readonly code: string;
  readonly params: ErrorParams;

  constructor(
    code: string,
    options: { readonly params?: ErrorParams; readonly cause?: unknown } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HeroError';
    this.code = code;
    this.params = options.params ?? {};
  }

  toJSON(): { readonly code: string; readonly params: ErrorParams } {
    return { code: this.code, params: this.params };
  }
}

export function isHeroError(value: unknown): value is HeroError {
  return value instanceof HeroError;
}
