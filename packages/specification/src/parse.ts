import { isAlias, isNode, parseDocument, stringify, visit } from 'yaml';
import type { HeroSpec } from './types.js';
import { heroSpecSchema } from './schema.js';

export const MAX_SPEC_BYTES = 256 * 1024;
const MAX_DEPTH = 16;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// The only explicit tags a spec may carry: the YAML 1.2 core types.
const CORE_TAGS = new Set(
  ['map', 'seq', 'str', 'int', 'float', 'bool', 'null'].map((name) => `tag:yaml.org,2002:${name}`),
);

/** Where a spec came from. Only `user` and `analysis` are trusted to skip review. */
export type SpecOrigin = 'user' | 'repository' | 'analysis';

export interface SpecIssue {
  readonly code: string;
  readonly path: string;
}

export type ParseResult =
  | { readonly ok: true; readonly spec: HeroSpec }
  | { readonly ok: false; readonly issues: readonly SpecIssue[] };

function fail(code: string, path = ''): ParseResult {
  return { ok: false, issues: [{ code, path }] };
}

function depthOf(value: unknown, level = 0): number {
  if (level > MAX_DEPTH) return level;
  if (Array.isArray(value)) {
    return Math.max(level, ...value.map((item) => depthOf(item, level + 1)));
  }
  if (typeof value === 'object' && value !== null) {
    return Math.max(level, ...Object.values(value).map((item) => depthOf(item, level + 1)));
  }
  return level;
}

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(
      ([key, item]) => FORBIDDEN_KEYS.has(key) || hasForbiddenKey(item),
    );
  }
  return false;
}

/** Validates an already-parsed value (for example a spec produced by the analyzer). */
export function validateHeroSpec(value: unknown): ParseResult {
  if (hasForbiddenKey(value)) return fail('spec.forbidden-key');
  if (depthOf(value) > MAX_DEPTH) return fail('spec.too-deep');
  const result = heroSpecSchema.safeParse(value);
  if (result.success) return { ok: true, spec: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      code: issue.message.startsWith('spec.')
        ? issue.message
        : `spec.${issue.code.replace(/_/g, '-')}`,
      path: issue.path.join('.'),
    })),
  };
}

/**
 * Parses `hero.yaml` safely: size-limited, YAML 1.2 core schema only (no custom tags), no aliases
 * or anchors, no merge keys, no duplicate keys, a single document, bounded depth, and no keys that
 * could pollute prototypes. The result is then validated against the strict schema.
 */
export function parseHeroSpec(text: string): ParseResult {
  if (new TextEncoder().encode(text).byteLength > MAX_SPEC_BYTES) return fail('spec.too-large');

  const document = parseDocument(text, {
    schema: 'core',
    version: '1.2',
    uniqueKeys: true,
    merge: false,
    strict: true,
    prettyErrors: false,
    // 'silent' would also suppress MULTIPLE_DOCS and other errors. 'error' records them without printing.
    logLevel: 'error',
  });
  if (document.errors.length > 0 || document.warnings.length > 0) return fail('spec.invalid-yaml');

  const unsafe: string[] = [];
  visit(document, {
    Node(_key, node) {
      if (isAlias(node)) unsafe.push('alias');
      const { anchor, tag } = node as { anchor?: string; tag?: string };
      if (anchor !== undefined) unsafe.push('anchor');
      if (isNode(node) && tag !== undefined && !CORE_TAGS.has(tag)) {
        unsafe.push('tag');
      }
    },
  });
  if (unsafe.length > 0) return fail('spec.yaml-feature-not-allowed');

  const value: unknown = document.toJS({ maxAliasCount: 0 });
  return validateHeroSpec(value);
}

/** Writes a Hero Spec as stable, readable YAML (`hero.yaml`). */
export function serializeHeroSpec(spec: HeroSpec): string {
  return stringify(spec, { lineWidth: 100, sortMapEntries: false });
}
