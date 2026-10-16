import { describe, expect, it } from 'vitest';
import { MAX_SPEC_BYTES, parseHeroSpec, serializeHeroSpec, validateHeroSpec } from './parse.js';
import type { HeroSpec } from './types.js';

const VALID = `
version: '1'
application:
  name: store
frontend:
  framework: vite
  build:
    command: npm run build
    output: dist
services:
  - id: api
    type: http
    runtime: nodejs
    port: 3000
    healthPath: /health
data:
  - id: products
    type: key-value
storage:
  - id: uploads
    type: object
auth:
  required: true
environment:
  - API_SECRET
`;

function codes(result: ReturnType<typeof parseHeroSpec>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('parseHeroSpec', () => {
  it('accepts the documented example', () => {
    const result = parseHeroSpec(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.services?.[0]?.id).toBe('api');
      expect(result.spec.environment).toEqual(['API_SECRET']);
    }
  });

  it('round-trips through serialization', () => {
    const parsed = parseHeroSpec(VALID);
    if (!parsed.ok) throw new Error('fixture must be valid');
    const again = parseHeroSpec(serializeHeroSpec(parsed.spec));
    expect(again).toEqual(parsed);
  });

  it('accepts a minimal spec and a legacy process service', () => {
    const minimal = `version: '1'\napplication:\n  name: tiny\n`;
    expect(parseHeroSpec(minimal).ok).toBe(true);
    const legacy = `
version: '1'
application: { name: old-site }
services:
  - { id: web, type: process, runtime: php8.2, port: 8080, start: { command: 'php -S 0.0.0.0:8080' } }
data:
  - { id: main, type: relational, engine: mysql }
storage:
  - { id: uploads, type: file-system }
`;
    expect(parseHeroSpec(legacy).ok).toBe(true);
  });

  describe('rejects hostile or malformed input', () => {
    it('unknown keys at any level', () => {
      expect(parseHeroSpec(`${VALID}\nunexpected: true\n`).ok).toBe(false);
      expect(parseHeroSpec(VALID.replace('type: http', 'type: http\n    admin: true')).ok).toBe(
        false,
      );
    });

    it('YAML aliases and anchors', () => {
      const withAlias = `version: '1'\napplication: &a\n  name: x\nextensions:\n  x-a: *a\n`;
      expect(parseHeroSpec(withAlias).ok).toBe(false);
      expect(parseHeroSpec(`version: '1'\napplication: &a\n  name: x\n`).ok).toBe(false);
    });

    it('merge keys', () => {
      const merge = `version: '1'\napplication:\n  <<: { name: x }\n`;
      expect(parseHeroSpec(merge).ok).toBe(false);
    });

    it('custom tags', () => {
      expect(parseHeroSpec(`version: '1'\napplication:\n  name: !!js/function x\n`).ok).toBe(false);
      expect(parseHeroSpec(`version: '1'\napplication: !custom\n  name: x\n`).ok).toBe(false);
    });

    it('duplicate keys and multiple documents', () => {
      expect(parseHeroSpec(`version: '1'\nversion: '1'\napplication:\n  name: x\n`).ok).toBe(false);
      expect(parseHeroSpec(`${VALID}\n---\n${VALID}`).ok).toBe(false);
    });

    it('prototype-polluting keys', () => {
      const payload = `version: '1'\napplication:\n  name: x\nextensions:\n  x-a:\n    __proto__:\n      polluted: true\n`;
      const result = parseHeroSpec(payload);
      expect(result.ok).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('oversized input', () => {
      const big = `version: '1'\napplication:\n  name: x\n#${'a'.repeat(MAX_SPEC_BYTES)}\n`;
      expect(codes(parseHeroSpec(big))).toEqual(['spec.too-large']);
    });

    it('invalid YAML', () => {
      expect(parseHeroSpec('version: [').ok).toBe(false);
      expect(parseHeroSpec('').ok).toBe(false);
    });

    it('wrong version', () => {
      expect(parseHeroSpec(`version: '2'\napplication:\n  name: x\n`).ok).toBe(false);
    });
  });

  describe('field constraints', () => {
    const base = (service: string): string =>
      `version: '1'\napplication:\n  name: x\nservices:\n  - { id: api, type: http, runtime: nodejs, ${service} }\n`;

    it.each([
      ['an absolute URL', 'healthPath: http://169.254.169.254/latest/meta-data'],
      ['a protocol-relative URL', "healthPath: '//evil.example/x'"],
      ['a path with traversal', 'healthPath: /a/../b'],
      ['a query string', "healthPath: '/health?x=1'"],
      ['a path without a leading slash', 'healthPath: health'],
    ])('refuses a health path that is %s', (_label, field) => {
      expect(parseHeroSpec(base(field)).ok).toBe(false);
    });

    it('accepts a plain health path', () => {
      expect(parseHeroSpec(base('healthPath: /api/v1/health')).ok).toBe(true);
    });

    it.each([0, 65536, 3.5, -1])('refuses port %s', (port) => {
      expect(parseHeroSpec(base(`port: ${port}`)).ok).toBe(false);
    });

    it.each(['0 * * * *', '*/5 * * * *', '0 9 * * 1-5', '15,45 * * * *'])(
      'accepts the schedule %s',
      (schedule) => {
        expect(parseHeroSpec(base(`schedule: '${schedule}'`)).ok).toBe(true);
      },
    );

    it.each([
      'every day',
      '0 * * *',
      '0 * * * * *',
      '0 * * * *; rm -rf /',
      '@daily',
      '$(whoami) * * * *',
    ])('refuses the schedule %s', (schedule) => {
      expect(parseHeroSpec(base(`schedule: '${schedule}'`)).ok).toBe(false);
    });

    it('refuses commands with control characters', () => {
      const text = `version: '1'\napplication:\n  name: x\nfrontend:\n  framework: vite\n  build:\n    command: "npm run build\\nrm -rf /"\n    output: dist\n`;
      expect(parseHeroSpec(text).ok).toBe(false);
    });

    it.each(['../outside', '/etc', 'a/../../b'])('refuses build output path %s', (output) => {
      const text = `version: '1'\napplication:\n  name: x\nfrontend:\n  framework: vite\n  build:\n    command: npm run build\n    output: ${output}\n`;
      expect(parseHeroSpec(text).ok).toBe(false);
    });

    it('refuses duplicate ids across components and duplicate environment names', () => {
      const dup = `version: '1'\napplication:\n  name: x\nservices:\n  - { id: main, type: http, runtime: nodejs }\ndata:\n  - { id: main, type: key-value }\n`;
      expect(codes(parseHeroSpec(dup))).toContain('spec.duplicate-id');
      const env = `version: '1'\napplication:\n  name: x\nenvironment: [A, A]\n`;
      expect(codes(parseHeroSpec(env))).toContain('spec.duplicate-environment-name');
    });

    it('refuses environment values disguised as names', () => {
      const text = `version: '1'\napplication:\n  name: x\nenvironment: ['TOKEN=abc123']\n`;
      expect(parseHeroSpec(text).ok).toBe(false);
    });

    it('requires extension keys to start with x-', () => {
      const text = `version: '1'\napplication:\n  name: x\nextensions:\n  anything: 1\n`;
      expect(parseHeroSpec(text).ok).toBe(false);
    });
  });
});

describe('validateHeroSpec', () => {
  it('validates values produced in memory', () => {
    const spec: HeroSpec = { version: '1', application: { name: 'ok' } };
    expect(validateHeroSpec(spec).ok).toBe(true);
    expect(validateHeroSpec({ version: '1' }).ok).toBe(false);
    expect(validateHeroSpec(null).ok).toBe(false);
  });

  it('rejects excessive nesting before validation', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 40; i += 1) deep = { x: deep };
    expect(validateHeroSpec(deep).ok).toBe(false);
  });
});
