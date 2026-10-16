import { describe, expect, it } from 'vitest';
import { normalizeEntryPath } from './paths.js';
import { DEFAULT_LIMITS } from './policy.js';

const normalize = (path: string): string => normalizeEntryPath(path, DEFAULT_LIMITS);

describe('normalizeEntryPath', () => {
  it('accepts normal relative paths and a directory trailing slash', () => {
    expect(normalize('src/index.ts')).toBe('src/index.ts');
    expect(normalize('a')).toBe('a');
    expect(normalize('docs/')).toBe('docs');
  });

  it.each([
    ['empty', ''],
    ['parent traversal', '../outside'],
    ['nested traversal', 'a/../../b'],
    ['a hidden traversal', 'a/b/../../../c'],
    ['an absolute path', '/etc/passwd'],
    ['a drive letter', 'C:/Windows/system32'],
    ['a backslash', 'a\\b'],
    ['a backslash traversal', '..\\evil'],
    ['a NUL byte', 'a\u0000b'],
    ['a control character', 'a\nb'],
    ['an empty segment', 'a//b'],
    ['a dot segment', 'a/./b'],
    ['a trailing dot (Windows aliasing)', 'file.'],
    ['a trailing space (Windows aliasing)', 'file '],
    ['an overlong path', 'a'.repeat(DEFAULT_LIMITS.maxPathLength + 1)],
    ['an excessive depth', Array.from({ length: 60 }, () => 'd').join('/')],
  ])('rejects %s', (_label, path) => {
    expect(() => normalize(path)).toThrow(expect.objectContaining({ code: 'source.unsafe-path' }));
  });
});
