/**
 * JSON Canonicalization Scheme (RFC 8785).
 *
 * Two values that mean the same thing always produce the same text, so a digest over that text is
 * stable. Strictly rejects anything JSON cannot represent: `undefined`, functions, symbols,
 * bigints, non-finite numbers, lone surrogates, dates, and cycles.
 */
const MAX_DEPTH = 64;

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i += 1;
      else return true;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function serializeString(text: string, path: string): string {
  if (hasLoneSurrogate(text)) {
    throw new CanonicalJsonError(`Lone surrogate in string at ${path}`);
  }
  return JSON.stringify(text);
}

function serialize(value: unknown, path: string, depth: number): string {
  if (depth > MAX_DEPTH)
    throw new CanonicalJsonError(`Nesting deeper than ${MAX_DEPTH} at ${path}`);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return serializeString(value, path);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`Non-finite number at ${path}`);
      }
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(`Unsupported ${typeof value} at ${path}`);
  }

  if (Array.isArray(value)) {
    const items = (value as readonly unknown[]).map((item, index) =>
      serialize(item, `${path}[${index}]`, depth + 1),
    );
    return `[${items.join(',')}]`;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(`Only plain objects are supported at ${path}`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const members = keys.map((key) => {
    return `${serializeString(key, `${path}.${key}`)}:${serialize(record[key], `${path}.${key}`, depth + 1)}`;
  });
  return `{${members.join(',')}}`;
}

/** Returns the canonical JSON text of a value. */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$', 0);
}

export type { Json };
