/**
 * Removes anything that looks like a secret before text leaves the machine. It errs on the side of
 * removing too much: a placeholder costs the model a little context, a leaked key costs far more.
 * Detection is by shape (known key formats, private key blocks, credentials in addresses, values
 * assigned to secret-sounding names), so it works on any text.
 */
const PLACEHOLDER = '[redacted]';

const PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{16}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi,
];

/** `NAME = value` or `"name": "value"` where the name sounds secret: the value goes. */
const ASSIGNMENT =
  /((?:^|[^A-Za-z0-9])[A-Za-z0-9_.-]*(?:secret|passw(?:or)?d|passwd|pwd|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|auth)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi;

export interface Redacted<T> {
  readonly value: T;
  readonly redactions: number;
}

/** Redacts one piece of text. */
export function redactText(text: string): Redacted<string> {
  let count = 0;
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, () => {
      count += 1;
      return PLACEHOLDER;
    });
  }
  out = out.replace(ASSIGNMENT, (_match, head: string) => {
    count += 1;
    return `${head}${PLACEHOLDER}`;
  });
  return { value: out, redactions: count };
}

/** Redacts every string inside a value made of objects, arrays, and strings. */
export function redact<T>(value: T): Redacted<T> {
  let total = 0;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const result = redactText(node);
      total += result.redactions;
      return result.value;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]));
    }
    return node;
  };
  const redacted = walk(value) as T;
  return { value: redacted, redactions: total };
}
