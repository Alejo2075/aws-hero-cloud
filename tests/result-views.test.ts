import type { DeploymentResult, Health } from '@hero-cloud/core';
import { healthCheckCodes } from '@hero-cloud/core';
import { audienceLevels, createPresenter } from '@hero-cloud/presentation';
import type { Block, View } from '@hero-cloud/presentation';
import { describe, expect, it } from 'vitest';

const presenter = createPresenter();

const health: Health = {
  status: 'degraded',
  checkedAt: '2026-03-04T10:30:00.000Z',
  components: [
    { component: 'website', status: 'degraded', checks: ['website.reachability', 'website.smoke'] },
  ],
  checks: [
    {
      id: 'stack.resource-state',
      component: 'stack',
      kind: 'resource-state',
      code: 'health.resource-state',
      status: 'passed',
      target: 'CREATE_COMPLETE',
    },
    {
      id: 'website.reachability',
      component: 'website',
      kind: 'reachability',
      code: 'health.reachability',
      status: 'passed',
      target: 'd1.cloudfront.net',
      observed: { statusCode: 200, latencyMs: 120 },
    },
    {
      id: 'website.smoke',
      component: 'website',
      kind: 'smoke',
      code: 'health.smoke.bad-status',
      status: 'failed',
      target: '/health',
      observed: { statusCode: 503 },
    },
  ],
};

const result: DeploymentResult = {
  deploymentId: 'hero-shop',
  planId: 'plan_x',
  status: 'partial',
  endpoints: [{ kind: 'url', label: 'website', value: 'https://d1.cloudfront.net', public: true }],
  health,
  resources: [{ provider: 'aws', type: 'AWS::S3::Bucket', name: 'Files', id: 'bkt-1' }],
  sensitiveOutputs: [{ name: 'API_KEY', location: 'ssm:/hero/hero-shop/API_KEY' }],
  links: [{ kind: 'console', label: 'cloudformation', value: 'https://console.aws.amazon.com/x' }],
  cost: {
    currency: 'USD',
    monthlyLow: 0.2,
    monthlyHigh: 2.4,
    confidence: 'medium',
    lines: [],
    assumptions: [],
    priceSource: 'built-in',
    pricesAsOf: '2026-01-01',
  },
  nextSteps: [
    { code: 'next.check-health' },
    { code: 'next.set-secrets' },
    { code: 'next.destroy' },
  ],
  completedAt: '2026-03-04T10:30:00.000Z',
};

const text = (view: View): string => {
  const block = (b: Block): string => {
    switch (b.type) {
      case 'paragraph':
      case 'callout':
      case 'code':
        return b.text;
      case 'list':
        return b.items.join('\n');
      case 'table':
        return [b.columns.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('\n');
    }
  };
  return [view.title, ...view.sections.flatMap((s) => [s.heading, ...s.blocks.map(block)])].join(
    '\n',
  );
};

const combos = audienceLevels.flatMap((level) =>
  ['en', 'es'].map((locale) => [level, locale] as const),
);

describe('result view', () => {
  it.each(combos)('%s / %s: complete, with nothing unresolved', (audience, locale) => {
    const out = text(presenter.result(result, { audience, locale }));
    expect(out).toContain('https://d1.cloudfront.net');
    expect(out).not.toMatch(/\{[A-Za-z]+\}/);
    expect(out).not.toMatch(/\b(?:rationale|warning|check|view|health)\.[a-z]/);
    // The limits of the checks are stated at every level, and a failure is never hidden.
    const limits = presenter.text('view.health.limits', { audience, locale });
    expect(out).toContain(limits);
    expect(out).toMatch(/503|problema|problem|error/i);
  });

  it('simple: plain words, no addresses of AWS internals, cost as a range', () => {
    const out = text(presenter.result(result, { audience: 'simple', locale: 'en' }));
    expect(out).toContain('something is not working yet');
    expect(out).toContain('$0.20 to $2.40');
    expect(out).not.toMatch(/ssm:|cloudformation|AWS::S3|CREATE_COMPLETE/);
    expect(out).toContain('API_KEY');
  });

  it('guided: says what each check saw, and where the secrets go', () => {
    const out = text(presenter.result(result, { audience: 'guided', locale: 'en' }));
    expect(out).toContain('d1.cloudfront.net');
    expect(out).toContain('(code 200) in 120 ms');
    expect(out).toContain('ssm:/hero/hero-shop/API_KEY');
    expect(out).toContain('The setup in AWS');
  });

  it('expert: a table of every check and every resource', () => {
    const view = presenter.result(result, { audience: 'expert', locale: 'en' });
    const out = text(view);
    expect(out).toContain('website | smoke | failed');
    expect(out).toContain('AWS::S3::Bucket | Files | bkt-1');
    expect(view.sections.map((s) => s.id)).toEqual([
      'summary',
      'reach',
      'health',
      'cost',
      'links',
      'resources',
      'secrets',
      'next',
    ]);
  });

  it('a removal says what was kept and offers no address', () => {
    const removed: DeploymentResult = {
      ...result,
      status: 'succeeded',
      endpoints: [],
      health: { status: 'unknown', checkedAt: result.completedAt, components: [], checks: [] },
      nextSteps: [{ code: 'next.review-kept-data' }],
    };
    for (const audience of audienceLevels) {
      const out = text(presenter.result(removed, { audience, locale: 'en' }));
      expect(out).toMatch(/remov/i);
      expect(out).not.toContain('https://d1.cloudfront.net');
      expect(out).toMatch(/kept|keep/i);
    }
  });
});

describe('health view', () => {
  it.each(combos)('%s / %s: every check code has words', (audience, locale) => {
    const all: Health = {
      ...health,
      checks: healthCheckCodes.map((code, index) => ({
        id: `c${String(index)}`,
        component: 'website',
        kind: 'reachability' as const,
        code,
        status: 'failed' as const,
        target: 'x.example',
        observed: { statusCode: 500, latencyMs: 1 },
      })),
    };
    const out = text(presenter.health('hero-shop', all, { audience, locale }));
    expect(out).not.toMatch(/\{[A-Za-z]+\}/);
    expect(out).not.toMatch(/\bcheck\.health/);
  });

  it('never calls a deployment healthy unless the status is healthy', () => {
    const out = text(presenter.health('hero-shop', health, { audience: 'simple', locale: 'en' }));
    expect(out).not.toMatch(/Working\. Every check/);
    const ok = text(
      presenter.health(
        'hero-shop',
        { ...health, status: 'healthy' },
        { audience: 'simple', locale: 'en' },
      ),
    );
    expect(ok).toContain('Working. Every check Hero ran passed.');
  });
});

describe('destroy plan view', () => {
  it('reads as a removal at every level', async () => {
    const { sealPlan } = await import('@hero-cloud/core');
    const plan = sealPlan({
      application: 'shop',
      specVersion: '1',
      sourceHash: 'ab'.repeat(32),
      strategy: 'serverless',
      strategyRationale: [],
      target: { provider: 'aws', region: 'us-east-1', accountId: '123456789012' },
      changes: [
        {
          id: 'c1',
          action: 'delete',
          capability: 'http-service',
          resource: { provider: 'aws', type: 'lambda-function', name: 'api' },
          destructive: true,
          rationale: [],
        },
      ],
      warnings: [{ code: 'plan.destroy-keeps-data', severity: 'warning', params: { count: 1 } }],
      requiredInputs: [],
      artifactHash: 'cd'.repeat(32),
      intent: 'destroy',
      deploymentId: 'hero-shop',
    });
    for (const audience of audienceLevels) {
      const out = text(presenter.plan(plan, { audience, locale: 'en' }));
      expect(out).toContain('Removing shop');
      if (audience !== 'expert') expect(out).toContain('What will be removed');
      expect(out).not.toContain('What will be created');
      expect(out).not.toMatch(/\{[A-Za-z]+\}/);
    }
  });
});

describe('an update that replaces something', () => {
  it('says so at every level and in both languages, and explains when it could not compare', async () => {
    const { sealPlan } = await import('@hero-cloud/core');
    const plan = sealPlan({
      application: 'shop',
      specVersion: '1',
      sourceHash: 'ab'.repeat(32),
      strategy: 'serverless',
      strategyRationale: [],
      target: { provider: 'aws', region: 'us-east-1', accountId: '123456789012' },
      changes: [
        {
          id: 'c1',
          action: 'replace',
          capability: 'key-value-data',
          resource: { provider: 'aws', type: 'dynamodb-table', name: 'orders' },
          destructive: true,
          rationale: [],
        },
        {
          id: 'c2',
          action: 'update',
          capability: 'http-service',
          resource: { provider: 'aws', type: 'lambda-function', name: 'api' },
          destructive: false,
          rationale: [],
        },
      ],
      warnings: [
        { code: 'plan.destructive-changes', severity: 'warning', params: { count: 1 } },
        { code: 'plan.update-unverified', severity: 'warning', params: { reason: 'offline' } },
      ],
      requiredInputs: [],
      artifactHash: 'cd'.repeat(32),
    });
    for (const [audience, locale] of combos) {
      const view = presenter.plan(plan, { audience, locale });
      const out = text(view);
      expect(
        view.sections.some((s) => s.id === 'destructive'),
        `${audience}/${locale}`,
      ).toBe(true);
      expect(out).not.toMatch(/\{[A-Za-z]+\}/);
      expect(out).not.toMatch(/\b(?:warning|update|resource)\.[a-z]/);
      expect(out).toMatch(/1 /);
    }
    const guided = text(presenter.plan(plan, { audience: 'guided', locale: 'en' }));
    expect(guided).toContain('replace: DynamoDB table');
    expect(guided).toContain('you chose not to use the network');
    expect(text(presenter.plan(plan, { audience: 'simple', locale: 'en' }))).toContain(
      'replaced or removed',
    );
  });
});
