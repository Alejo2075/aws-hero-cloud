import { heroError } from '@hero-cloud/core';
import type { SourceLimits } from './policy.js';

// eslint-disable-next-line no-control-regex
const CONTROL_OR_NUL = /[\u0000-\u001f\u007f]/;

/**
 * Validates and normalizes an entry path that came from an untrusted source (such as a ZIP). The
 * result is relative, uses `/`, and cannot escape the root. Throws `source.unsafe-path` otherwise.
 */
export function normalizeEntryPath(raw: string, limits: SourceLimits): string {
  const fail = (): never => {
    throw heroError('source.unsafe-path');
  };
  if (raw.length === 0 || raw.length > limits.maxPathLength) return fail();
  if (CONTROL_OR_NUL.test(raw)) return fail();
  if (raw.includes('\\')) return fail();
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return fail();

  const segments = raw.split('/').filter((segment, index, all) => {
    // Allow a single trailing slash (directory entries) but no empty segments elsewhere.
    return !(segment === '' && index === all.length - 1);
  });
  if (segments.length === 0 || segments.length > limits.maxDepth) return fail();
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return fail();
    if (segment.endsWith(' ') || segment.endsWith('.')) return fail();
  }
  return segments.join('/');
}
