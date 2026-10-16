import type { DeploymentPlan } from '@hero-cloud/core';
import { sealPlan } from '@hero-cloud/core';
import { describe, expect, it } from 'vitest';
import { audienceLevels } from './audience.js';
import { createPresenter } from './presenter.js';
import type { Block, RenderOptions, View } from './types.js';

const plan: DeploymentPlan = sealPlan({
  application: 'orders-api',
  specVersion: '1',
  sourceHash: 'ab'.repeat(32),
  strategy: 'serverless',
  strategyRationale: [
    {
      code: 'strategy.serverless',
      evidence: ['capability:http-service', 'capability:key-value-data'],
    },
  ],
  target: { provider: 'aws', region: 'us-east-1', accountId: '123456789012' },
  changes: [
    {
      id: 'http-service.api:lambda-function:api',
      action: 'create',
      capability: 'http-service',
      resource: { provider: 'aws', type: 'lambda-function', name: 'api' },
      destructive: false,
      rationale: [
        {
          code: 'service.http.serverless',
          evidence: ['dependency:fastify@^5.0.0', 'source:listen-port'],
        },
      ],
      details: { runtime: 'nodejs22.x', memoryMb: 512 },
    },
    {
      id: 'key-value-table.kv:dynamodb-table:kv',
      action: 'create',
      capability: 'key-value-data',
      resource: { provider: 'aws', type: 'dynamodb-table', name: 'kv' },
      destructive: false,
      rationale: [
        { code: 'data.key-value.on-demand' },
        { code: 'guardrail.backups' },
        { code: 'guardrail.encryption' },
      ],
      details: { billing: 'on-demand' },
    },
    {
      id: 'budget-alert.budget:budgets-budget:budget',
      action: 'create',
      capability: 'cost-control',
      resource: { provider: 'aws', type: 'budgets-budget', name: 'budget' },
      destructive: false,
      rationale: [{ code: 'guardrail.budget' }],
    },
  ],
  warnings: [
    {
      code: 'plan.open-question',
      severity: 'blocking',
      params: { question: 'service.start-unknown', kind: 'service.start-unknown', service: 'api' },
    },
    {
      code: 'plan.unsupported-capability',
      severity: 'blocking',
      params: { capability: 'relational-data', needs: 'container' },
    },
    { code: 'plan.public-exposure', severity: 'info', params: { kinds: 'http-service' } },
    {
      code: 'plan.cost-low-confidence',
      severity: 'info',
      params: { reason: 'offline', region: 'us-east-1' },
    },
  ],
  requiredInputs: [
    {
      name: 'API_KEY',
      kind: 'secret',
      reason: { code: 'input.secret', params: { name: 'API_KEY' } },
    },
    {
      name: 'TABLE_NAME',
      kind: 'config',
      reason: { code: 'input.config', params: { name: 'TABLE_NAME' } },
    },
  ],
  cost: {
    currency: 'USD',
    monthlyLow: 0.2,
    monthlyHigh: 2.4,
    confidence: 'medium',
    lines: [
      { code: 'api-requests', monthlyLow: 0, monthlyHigh: 1 },
      { code: 'database-operations', monthlyLow: 0, monthlyHigh: 0.56 },
    ],
    assumptions: [{ code: 'cost.assumption.traffic', params: { low: 1000, high: 1000000 } }],
    priceSource: 'live',
    pricesAsOf: '2026-10-15',
  },
  artifactHash: 'cd'.repeat(32),
});

const presenter = createPresenter();
const render = (
  audience: RenderOptions['audience'],
  locale = 'en',
  p: DeploymentPlan = plan,
): View => presenter.plan(p, { audience, locale });

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

describe('plan view: levels change depth, never the facts that matter', () => {
  it.each(audienceLevels)(
    'at %s, always shows the blocking issues, the cost, and that nothing happens until approval',
    (level) => {
      const text = textOf(render(level));
      expect(text).toContain('Before this can go online');
      expect(text).toMatch(/\$2\.40|\$1\.00/);
      expect(text.toLowerCase()).toMatch(/nothing is created|no resource is created/);
      // Both blocking warnings appear, worded for the level.
      const block = render(level).sections.find((s) => s.id === 'blocking')?.blocks[0];
      expect(block?.type).toBe('list');
      expect(block?.type === 'list' ? block.items : []).toHaveLength(2);
    },
  );

  it('simple: plain words, no AWS names, no digests', () => {
    const text = textOf(render('simple'));
    expect(text).toContain('Your plan for orders-api');
    expect(text).toContain(
      'Hero can put orders-api online on your own AWS account. Nothing has been created yet.',
    );
    expect(text).toContain('A program that answers requests');
    expect(text).toContain('Safe by default');
    expect(text).toContain('Your data is backed up.');
    expect(text).not.toMatch(/Lambda|DynamoDB|S3|CloudFront|IAM|arn:|digest|sha|0\.56|dynamodb/i);
    expect(text).toContain('Settings you will need to provide: 2');
    expect(text).toContain('Secrets among them: 1');
  });

  it('simple: says the cost in words a beginner understands', () => {
    expect(textOf(render('simple'))).toContain('It should cost about $0.20 to $2.40 a month.');
  });

  it('guided: explains each resource and why, with the evidence', () => {
    const text = textOf(render('guided'));
    expect(text).toContain('Lambda function (runs your code on demand) [api]');
    expect(text).toContain('uses the fastify@^5.0.0 library');
    expect(text).toContain('DynamoDB table (on-demand, with point-in-time backups) [kv]');
    expect(text).toContain('Why this approach');
    expect(text).toContain('needs an HTTP service');
    expect(text).toContain('API requests (API Gateway)');
    expect(text).toContain('Traffic is assumed to range from 1000 to 1000000 requests a month.');
    expect(text).toContain('API_KEY | secret');
  });

  it('expert: every change, its reason code and evidence, its settings, the cost lines, and the seal', () => {
    const v = render('expert');
    const text = textOf(v);
    expect(v.sections.map((s) => s.id)).toEqual([
      'summary',
      'blocking',
      'changes',
      'rationale',
      'details',
      'cost',
      'warnings',
      'inputs',
      'seal',
    ]);
    expect(text).toContain('create | aws:lambda:Function | api | no');
    expect(text).toContain(
      'service.http.serverless | dependency:fastify@^5.0.0, source:listen-port',
    );
    expect(text).toContain('"runtime": "nodejs22.x"');
    expect(text).toContain(plan.digest);
    expect(text).toContain('cd'.repeat(32));
    expect(text).toContain('ab'.repeat(32));
    expect(text).toContain('123456789012');
  });

  it('a plan without blocking issues is ready to approve', () => {
    const ready: DeploymentPlan = sealPlan({
      ...plan,
      warnings: [
        { code: 'plan.public-exposure', severity: 'info', params: { kinds: 'http-service' } },
      ],
    });
    for (const level of audienceLevels) {
      const view = render(level, 'en', ready);
      expect(view.sections.find((s) => s.id === 'blocking')).toBeUndefined();
      expect(textOf(view)).toMatch(/ready to approve|can be approved|can approve this plan/);
    }
  });

  it('says it is almost free when the cost is under a dollar', () => {
    const cheap: DeploymentPlan = sealPlan({
      ...plan,
      cost: { ...plan.cost!, monthlyLow: 0, monthlyHigh: 0.2 },
    });
    expect(textOf(render('simple', 'en', cheap))).toContain(
      'almost nothing: less than $1.00 a month',
    );
  });

  it('describes a blocked plan with no changes and no cost', () => {
    const { cost: _cost, ...withoutCost } = plan;
    const empty: DeploymentPlan = sealPlan({
      ...withoutCost,
      strategy: 'container',
      strategyRationale: [
        { code: 'strategy.needs-container', evidence: ['capability:relational-data'] },
      ],
      changes: [],
    });
    const reason: Record<string, string> = {
      simple: 'cannot put online yet',
      guided: 'does not support yet',
      expert: 'requires strategy relational-data'.replace('relational-data', 'container'),
    };
    for (const level of audienceLevels) {
      const view = render(level, 'en', empty);
      expect(view.sections.find((s) => s.id === 'cost')).toBeUndefined();
      expect(view.sections.find((s) => s.id === 'creates' || s.id === 'changes')).toBeUndefined();
      expect(textOf(view)).toContain(reason[level] ?? '');
    }
  });

  it('is deterministic', () => {
    expect(render('guided')).toEqual(render('guided'));
  });
});

describe('plan view: Spanish', () => {
  it('words the plan in Spanish at every level', () => {
    expect(textOf(render('simple', 'es'))).toContain('Tu plan para orders-api');
    expect(textOf(render('simple', 'es'))).toContain('Debería costar entre');
    expect(textOf(render('guided', 'es'))).toContain(
      'Función Lambda (ejecuta tu código bajo demanda) [api]',
    );
    expect(textOf(render('expert', 'es'))).toContain('Digest del plan');
  });

  it("uses the locale's money format", () => {
    expect(textOf(render('simple', 'es'))).toMatch(/US\$|\$/);
  });
});

describe('plan view: nothing unresolved reaches the reader', () => {
  it.each(
    audienceLevels.flatMap((level) => ['en', 'es'].map((locale) => [level, locale] as const)),
  )('%s / %s', (level, locale) => {
    const text = textOf(render(level, locale));
    expect(text).not.toMatch(/\{[A-Za-z]+\}/); // an unfilled placeholder
    expect(text).not.toMatch(
      /\b(?:rationale|warning|resource|capability|question|cost\.line|strategy\.name)\.[a-z]/,
    ); // a raw code
  });
});
