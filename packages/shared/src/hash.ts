import { createHash, timingSafeEqual } from 'node:crypto';

/** Lowercase hexadecimal SHA-256 of text (UTF-8) or bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Compares two hex digests without leaking where they differ. */
export function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
