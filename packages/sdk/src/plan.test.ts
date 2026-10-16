import { join, resolve } from 'node:path';
import { approvalFromChallenge, heroError, isSealIntact } from '@hero-cloud/core';
import type { CloudProvider, ProviderPlanRequest } from '@hero-cloud/core';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import { describe, expect, it } from 'vitest';
import { createHero, deploymentIdFor } from './engine.js';

const examples = resolve(import.meta.dirname, '..', '..', '..', 'examples');
const ACCOUNT = '123456789012';

async function analysisOf(name: string, hero = createHero()) {
  return hero.analyze({ kind: 'directory', location: join(examples, name) });
}

describe('createHero().plan', () => {
  it('plans a static site as static hosting and seals the plan', async () => {
    const hero = createHero();
    const plan = await hero.plan(await analysisOf('spa'), { accountId: ACCOUNT, offline: true });
    expect(plan.strategy).toBe('static');
    expect(plan.application).toBe('hero-example-spa');
    expect(plan.target).toEqual({ provider: 'aws', region: 'us-east-1', accountId: ACCOUNT });
    expect(plan.changes.map((c) => c.resource.type)).toContain('cloudfront-distribution');
    expect(isSealIntact(plan)).toBe(true);
    expect(plan.id).toBe(`plan_${plan.digest.slice(0, 24)}`);
  });

  it('plans an API with a key-value store as serverless, with cost and required inputs', async () => {
    const plan = await createHero().plan(await analysisOf('api-dynamodb'), {
      accountId: ACCOUNT,
      offline: true,
    });
    expect(plan.strategy).toBe('serverless');
    const types = plan.changes.map((c) => c.resource.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'apigatewayv2-api',
        'lambda-function',
        'dynamodb-table',
        'iam-role',
        'budgets-budget',
      ]),
    );
    expect(plan.cost?.monthlyHigh).toBeGreaterThan(0);
    expect(plan.requiredInputs.map((i) => i.name)).toEqual([
      'API_KEY',
      'TABLE_NAME',
      'BUDGET_ALERT_EMAIL',
    ]);
    expect(plan.warnings.filter((w) => w.severity === 'blocking')).toEqual([]);
  });

  it('binds the plan to the exact source that was analyzed', async () => {
    const hero = createHero();
    const analysis = await analysisOf('spa', hero);
    const plan = await hero.plan(analysis, { accountId: ACCOUNT, offline: true });
    expect(plan.sourceHash).toBe(analysis.sourceHash);
    const changed = await hero.plan(
      { ...analysis, sourceHash: 'f'.repeat(64) },
      { accountId: ACCOUNT, offline: true },
    );
    expect(changed.digest).not.toBe(plan.digest);
  });

  it('is deterministic: the same analysis and options give the same digest', async () => {
    const hero = createHero();
    const analysis = await analysisOf('spa-api', hero);
    const a = await hero.plan(analysis, { accountId: ACCOUNT, offline: true });
    const b = await hero.plan(analysis, { accountId: ACCOUNT, offline: true });
    expect(a.digest).toBe(b.digest);
  });

  it('produces a different plan for a different account or region', async () => {
    const hero = createHero();
    const analysis = await analysisOf('spa', hero);
    const base = await hero.plan(analysis, { accountId: ACCOUNT, offline: true });
    expect(
      (await hero.plan(analysis, { accountId: '999999999999', offline: true })).digest,
    ).not.toBe(base.digest);
    expect(
      (await hero.plan(analysis, { accountId: ACCOUNT, region: 'eu-west-1', offline: true }))
        .digest,
    ).not.toBe(base.digest);
  });

  describe('a plan that cannot be approved yet', () => {
    it('without a verified account, it is a preview', async () => {
      const plan = await createHero().plan(await analysisOf('spa'), { offline: true });
      expect(plan.target.accountId).toBe('000000000000');
      expect(plan.warnings[0]).toEqual({ code: 'plan.account-unverified', severity: 'blocking' });
    });

    it('with an unanswered question that blocks', async () => {
      const plan = await createHero().plan(await analysisOf('monorepo'), {
        accountId: ACCOUNT,
        offline: true,
      });
      expect(
        plan.warnings.some(
          (w) => w.severity === 'blocking' && w.params?.kind === 'monorepo.choose-package',
        ),
      ).toBe(true);
    });

    it('with a capability Hero cannot deploy yet, it plans nothing instead of guessing', async () => {
      const hero = createHero();
      const analysis = await analysisOf('api-only', hero);
      const withDatabase = {
        ...analysis,
        spec: {
          ...analysis.spec,
          data: [{ id: 'database', type: 'relational' as const, engine: 'postgres' }],
        },
      };
      const plan = await hero.plan(withDatabase, { accountId: ACCOUNT, offline: true });
      expect(plan.strategy).toBe('container');
      expect(plan.changes).toEqual([]);
      expect(plan.cost).toBeUndefined();
      expect(
        plan.warnings.some(
          (w) => w.code === 'plan.unsupported-capability' && w.severity === 'blocking',
        ),
      ).toBe(true);
    });

    it('refuses to start an approval for it', async () => {
      const hero = createHero();
      const plan = await hero.plan(await analysisOf('spa'), { offline: true });
      await expect(hero.requestApproval(plan)).rejects.toMatchObject({
        code: 'plan.blocking-warning',
      });
    });
  });

  it('lets a plan with no blocking warning go on to an approval challenge, bound to its digest', async () => {
    const hero = createHero();
    const plan = await hero.plan(await analysisOf('spa'), { accountId: ACCOUNT, offline: true });
    const challenge = await hero.requestApproval(plan);
    expect(challenge).toMatchObject({
      planId: plan.id,
      planDigest: plan.digest,
      accountId: ACCOUNT,
      region: 'us-east-1',
    });
    expect(approvalFromChallenge(challenge, 'test').nonce).toBe(challenge.nonce);
  });

  it('carries the schedule of a scheduled job into the plan', async () => {
    const hero = createHero();
    const analysis = await analysisOf('scheduled-job', hero);
    expect(analysis.spec.services?.[0]?.schedule).toBe('0 * * * *');
    const plan = await hero.plan(analysis, { accountId: ACCOUNT, offline: true });
    expect(
      plan.changes.find((c) => c.resource.type === 'scheduler-schedule')?.details,
    ).toMatchObject({
      expression: 'cron(0 * * * ? *)',
    });
  });

  describe('identity', () => {
    const cloudWithIdentity = (account: string): CloudProvider => ({
      ...createAwsProvider(),
      identity: () => Promise.resolve({ account, principal: 'arn:test', kind: 'role' }),
    });

    it('plans for the account the credentials belong to when asked to', async () => {
      const hero = createHero({ cloud: cloudWithIdentity('210987654321') });
      const plan = await hero.plan(await analysisOf('spa', hero), {
        useIdentity: true,
        offline: true,
      });
      expect(plan.target.accountId).toBe('210987654321');
      expect(plan.warnings.some((w) => w.code === 'plan.account-unverified')).toBe(false);
    });

    it('prefers an account that is given over asking the cloud', async () => {
      const hero = createHero({ cloud: cloudWithIdentity('210987654321') });
      const plan = await hero.plan(await analysisOf('spa', hero), {
        accountId: ACCOUNT,
        useIdentity: true,
        offline: true,
      });
      expect(plan.target.accountId).toBe(ACCOUNT);
    });

    it('stops when the cloud refuses the identity, and says so when it cannot ask', async () => {
      const refusing: CloudProvider = {
        ...createAwsProvider(),
        identity: () => Promise.reject(heroError('identity.root-refused')),
      };
      const hero = createHero({ cloud: refusing });
      await expect(
        hero.plan(await analysisOf('spa', hero), { useIdentity: true, offline: true }),
      ).rejects.toMatchObject({ code: 'identity.root-refused' });
      const blind: CloudProvider = { id: 'blind', describe: createAwsProvider().describe.bind({}) };
      await expect(createHero({ cloud: blind }).identity()).rejects.toMatchObject({
        code: 'provider.unavailable',
      });
    });
  });

  describe('options are validated', () => {
    it.each([
      [{ region: '../x' }],
      [{ region: 'US-EAST-1' }],
      [{ accountId: '12345' }],
      [{ accountId: '12345678901a' }],
      [{ accountId: '123456789012\n' }],
    ])('%j is refused', async (options) => {
      const hero = createHero();
      await expect(
        hero.plan(await analysisOf('spa', hero), { ...options, offline: true }),
      ).rejects.toMatchObject({
        code: 'plan.invalid-answer',
      });
    });

    it('rejects an answer to a question that does not exist', async () => {
      const hero = createHero();
      await expect(
        hero.plan(await analysisOf('spa', hero), {
          accountId: ACCOUNT,
          offline: true,
          answers: { nope: 'x' },
        }),
      ).rejects.toMatchObject({ code: 'plan.invalid-answer' });
    });
  });

  describe('the cloud is a port', () => {
    function recording(): { cloud: CloudProvider; requests: ProviderPlanRequest[] } {
      const requests: ProviderPlanRequest[] = [];
      const real = createAwsProvider();
      return {
        requests,
        cloud: {
          id: 'test-cloud',
          describe: (request) => {
            requests.push(request);
            return real.describe(request);
          },
        },
      };
    }

    it('uses the provider it is given and reports its id as the target', async () => {
      const { cloud, requests } = recording();
      const hero = createHero({ cloud });
      const plan = await hero.plan(await analysisOf('spa', hero), {
        accountId: ACCOUNT,
        offline: true,
      });
      expect(plan.target.provider).toBe('test-cloud');
      expect(requests).toHaveLength(1);
    });

    it('never allows the network when offline, and allows it otherwise', async () => {
      const { cloud, requests } = recording();
      const hero = createHero({ cloud });
      const analysis = await analysisOf('spa', hero);
      await hero.plan(analysis, { accountId: ACCOUNT, offline: true });
      expect(requests[0]?.allowNetwork).toBe(false);
    });

    it('does not pass the budget email to the provider as a place to store a value', async () => {
      const { cloud, requests } = recording();
      const hero = createHero({ cloud });
      await hero.plan(await analysisOf('api-dynamodb', hero), {
        accountId: ACCOUNT,
        offline: true,
      });
      expect(requests[0]?.inputs.map((i) => i.name)).toEqual(['API_KEY', 'TABLE_NAME']);
    });

    it('passes the deployment name, derived from the application', async () => {
      const { cloud, requests } = recording();
      const hero = createHero({ cloud });
      await hero.plan(await analysisOf('api-dynamodb', hero), {
        accountId: ACCOUNT,
        offline: true,
      });
      expect(requests[0]?.deploymentId).toBe('hero-orders-api');
    });
  });
});

describe('deploymentIdFor', () => {
  it.each([
    ['My Cool App', 'hero-my-cool-app'],
    ['orders-api', 'hero-orders-api'],
    ['  --weird__name!!  ', 'hero-weird-name'],
    ['', 'hero-app'],
    ['!!!', 'hero-app'],
    ['A'.repeat(60), `hero-${'a'.repeat(40)}`],
  ])('turns %j into %s', (name, expected) => {
    expect(deploymentIdFor(name)).toBe(expected);
  });
});
