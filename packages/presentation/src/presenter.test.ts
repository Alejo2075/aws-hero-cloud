import type { Analysis } from '@hero-cloud/core';
import { HeroError } from '@hero-cloud/shared';
import { describe, expect, it } from 'vitest';
import { audienceLevels } from './audience.js';
import { createPresenter } from './presenter.js';
import type { Block, View } from './types.js';

const analysis: Analysis = {
  spec: {
    version: '1',
    application: { name: 'store' },
    frontend: { framework: 'vite', build: { command: 'npm run build', output: 'dist' } },
    services: [{ id: 'api', type: 'http', runtime: 'nodejs', port: 3000, healthPath: '/health' }],
    data: [{ id: 'database', type: 'relational', engine: 'postgres' }],
    storage: [{ id: 'assets', type: 'object' }],
    auth: { required: true },
    environment: ['DATABASE_URL', 'STRIPE_KEY'],
  },
  sourceHash: 'ab'.repeat(32),
  detections: [
    {
      capability: 'web-frontend',
      confidence: 0.95,
      evidence: ['dependency:vite@^7', 'file:vite.config.ts'],
    },
    {
      capability: 'http-service',
      confidence: 0.9,
      evidence: ['dependency:express@^5', 'source:listen-port'],
    },
    { capability: 'relational-data', confidence: 0.92, evidence: ['dependency:pg@^8'] },
    { capability: 'object-storage', confidence: 0.9, evidence: ['dependency:@aws-sdk/client-s3'] },
    { capability: 'authentication', confidence: 0.6, evidence: ['dependency:passport'] },
  ],
  openQuestions: [
    {
      id: 'monorepo.choose-package',
      code: 'monorepo.choose-package',
      options: ['apps/api', 'apps/web'],
    },
    { id: 'service.port-unknown', code: 'service.port-unknown', params: { service: 'api' } },
  ],
  skipped: [
    { path: '.env', reason: 'sensitive' },
    { path: 'keys/server.pem', reason: 'sensitive' },
    { path: 'node_modules', reason: 'ignored' },
  ],
  aiAssisted: false,
};

const presenter = createPresenter();

function textOf(view: View): string {
  const block = (b: Block): string => {
    switch (b.type) {
      case 'paragraph':
      case 'callout':
      case 'code':
        return b.text;
      case 'list':
        return b.items.join('\n');
      case 'table':
        return [b.columns.join(' | '), ...b.rows.map((row) => row.join(' | '))].join('\n');
    }
  };
  return [view.title, ...view.sections.flatMap((s) => [s.heading, ...s.blocks.map(block)])].join(
    '\n',
  );
}

const render = (audience: (typeof audienceLevels)[number], locale = 'en'): View =>
  presenter.analysis(analysis, { audience, locale });

describe('analysis view: levels are views of the same facts', () => {
  it.each(audienceLevels)(
    'at %s, never hides questions or the notice about skipped secrets',
    (level) => {
      const text = textOf(render(level));
      expect(text).toMatch(/2/); // the number of questions
      expect(view(level).sections.map((s) => s.id)).toContain('questions');
      expect(
        view(level)
          .sections.map((s) => s.id)
          .some((id) => id === 'left-out' || id === 'skipped'),
      ).toBe(true);
    },
  );

  function view(level: (typeof audienceLevels)[number]): View {
    return render(level);
  }

  it('never exposes the content of a secret, only that it was skipped', () => {
    for (const level of audienceLevels) {
      const text = textOf(render(level));
      expect(text).not.toContain('TOKEN=');
    }
  });

  it('simple: plain sentences, no jargon, no internal identifiers', () => {
    const text = textOf(render('simple'));
    expect(text).toContain('A website');
    expect(text).toContain('A database');
    expect(text).toContain('Storage for files');
    expect(text).not.toMatch(/package\.json|dependency|vite|express|sha|0\.9|hash/i);
    expect(text).toContain('Files ignored because they look like passwords or keys: 2');
  });

  it('guided: explains each part and why Hero believes it', () => {
    const text = textOf(render('guided'));
    expect(text).toContain('A website built with vite');
    expect(text).toContain('very sure');
    expect(text).toContain('uses the vite@^7 library');
    expect(text).toContain('A relational database (postgres)');
    expect(text).toContain('apps/api | apps/web');
    expect(text).toContain('.env: looks like a secret');
  });

  it('expert: raw detections, the Hero Spec, hashes, and the full question table', () => {
    const v = render('expert');
    const text = textOf(v);
    expect(v.sections.map((s) => s.id)).toEqual([
      'summary',
      'detections',
      'spec',
      'questions',
      'skipped',
      'details',
    ]);
    expect(text).toContain('web-frontend | 0.95 | dependency:vite@^7, file:vite.config.ts');
    expect(text).toContain('version: "1"');
    expect(text).toContain('ab'.repeat(32));
    expect(text).toContain('monorepo.choose-package');
    expect(text).toContain('.env | sensitive');
    const spec = v.sections.find((s) => s.id === 'spec')?.blocks[0];
    expect(spec).toMatchObject({ type: 'code', language: 'yaml' });
  });

  it('says plainly when nothing was recognized', () => {
    const empty: Analysis = {
      ...analysis,
      spec: { version: '1', application: { name: 'mystery' } },
      detections: [],
      openQuestions: [],
      skipped: [],
    };
    for (const level of audienceLevels) {
      const v = presenter.analysis(empty, { audience: level, locale: 'en' });
      expect(v.sections[0]?.blocks[0]).toMatchObject({ type: 'callout', tone: 'warning' });
    }
  });

  it('is deterministic', () => {
    expect(render('guided')).toEqual(render('guided'));
  });
});

describe('analysis view: locales', () => {
  it('renders Spanish', () => {
    const text = textOf(render('simple', 'es'));
    expect(text).toContain('Lo que Hero entendió de store');
    expect(text).toContain('Un sitio web');
    expect(text).toContain('Archivos ignorados porque parecen contraseñas o claves: 2');
  });

  it('falls back to English for a language without a catalog', () => {
    expect(textOf(render('simple', 'fr'))).toContain('What Hero understood about store');
  });

  it('accepts a regional locale', () => {
    expect(textOf(render('simple', 'es-MX'))).toContain('Lo que Hero entendió');
  });

  it('can add a language without code changes', () => {
    const custom = createPresenter({
      catalogs: [{ locale: 'en', messages: { 'view.analysis.title': 'Custom {name}' } }],
    });
    expect(custom.analysis(analysis, { audience: 'simple', locale: 'en' }).title).toBe(
      'Custom store',
    );
  });
});

describe('describeError', () => {
  it("describes engine errors in the reader's language and level", () => {
    const error = new HeroError('approval.expired');
    expect(presenter.describeError(error, { audience: 'simple', locale: 'en' }).message).toBe(
      'The approval is too old. Please approve again.',
    );
    expect(presenter.describeError(error, { audience: 'simple', locale: 'es' }).message).toBe(
      'La aprobación es demasiado antigua. Apruébala de nuevo.',
    );
    expect(presenter.describeError(error, { audience: 'expert', locale: 'en' }).message).toContain(
      'expiresAt',
    );
  });

  it('fills parameters', () => {
    const error = new HeroError('internal.not-implemented', { params: { operation: 'deploy' } });
    expect(presenter.describeError(error, { audience: 'expert', locale: 'en' }).message).toContain(
      'deploy',
    );
  });

  it('never leaks the cause or the stack of unknown errors', () => {
    const description = presenter.describeError(new Error('token=SECRET123 at /home/user/x.ts'), {
      audience: 'expert',
      locale: 'en',
    });
    expect(JSON.stringify(description)).not.toContain('SECRET123');
    expect(description.code).toBe('unknown');
  });

  it('shows a generic message for a code with no entry', () => {
    const description = presenter.describeError(new HeroError('made.up'), {
      audience: 'simple',
      locale: 'en',
    });
    expect(description.message).toBe('Something went wrong.');
  });
});
