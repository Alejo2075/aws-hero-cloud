import { resolve } from 'node:path';
import { approvalFromChallenge, heroError } from '@hero-cloud/core';
import type {
  CloudProvider,
  DeploymentLock,
  DeploymentPlan,
  Health,
  ProviderApplyRequest,
} from '@hero-cloud/core';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import { describe, expect, it } from 'vitest';
import { createHero } from './engine.js';

/**
 * Failure drills: what the engine does when the cloud fails in the ways real clouds fail. Each
 * drill checks the same things: the error is coded, nothing is recorded as deployed, the lock is
 * released, and a new approval can try again.
 */
const examples = resolve(import.meta.dirname, '..', '..', '..', 'examples');
const ACCOUNT = '123456789012';
const inputs = { BUDGET_ALERT_EMAIL: 'me@example.com' };

const healthy: Health = {
  status: 'healthy',
  checkedAt: '2026-01-01T00:00:00.000Z',
  components: [{ component: 'site', status: 'healthy', checks: ['site.reachability'] }],
  checks: [
    {
      id: 'site.reachability',
      component: 'site',
      kind: 'reachability',
      code: 'health.reachability',
      status: 'passed',
    },
  ],
};

function world(over: Partial<CloudProvider> = {}) {
  const real = createAwsProvider();
  const applied: ProviderApplyRequest[] = [];
  const cloud: CloudProvider = {
    id: 'aws',
    describe: (request) => real.describe(request),
    identity: () => Promise.resolve({ account: ACCOUNT, principal: 'arn:test', kind: 'role' }),
    apply: (request) => {
      applied.push(request);
      return Promise.resolve({
        endpoints: [
          { kind: 'url', label: 'website', value: 'https://d1.cloudfront.net', public: true },
        ],
        resources: [],
        sensitiveOutputs: [],
        links: [],
      });
    },
    health: () => Promise.resolve(healthy),
    ...over,
  };
  const log: string[] = [];
  const locks: DeploymentLock = {
    acquire: (id) => {
      log.push(`acquire:${id}`);
      return Promise.resolve(() => {
        log.push(`release:${id}`);
        return Promise.resolve();
      });
    },
  };
  const hero = createHero({ cloud, locks });
  const plan = async (): Promise<DeploymentPlan> => {
    const analysis = await hero.analyze({ kind: 'directory', location: resolve(examples, 'spa') });
    return hero.plan(analysis, { accountId: ACCOUNT, offline: true });
  };
  const approval = async (p: DeploymentPlan) =>
    approvalFromChallenge(await hero.requestApproval(p), 'test');
  return { hero, plan, approval, applied, log };
}

const balanced = (log: readonly string[]) =>
  log.filter((l) => l.startsWith('acquire')).length ===
  log.filter((l) => l.startsWith('release')).length;

describe('failure drills', () => {
  it('a failed deployment is reported, leaves no result behind, and can be tried again', async () => {
    let failures = 1;
    const w = world({
      apply: () => {
        if (failures-- > 0)
          return Promise.reject(heroError('deployment.failed', { stack: 'hero-spa' }));
        return Promise.resolve({
          endpoints: [
            { kind: 'url', label: 'website', value: 'https://d1.cloudfront.net', public: true },
          ],
          resources: [],
          sensitiveOutputs: [],
          links: [],
        });
      },
    });
    const plan = await w.plan();
    await expect(w.hero.deploy(plan, await w.approval(plan), { inputs })).rejects.toMatchObject({
      code: 'deployment.failed',
    });
    expect(balanced(w.log)).toBe(true);
    await expect(w.hero.outputs('hero-spa')).rejects.toBeDefined();

    const again = await w.hero.deploy(plan, await w.approval(plan), { inputs });
    expect(again.status).toBe('succeeded');
  });

  it('expired credentials stop the deployment before anything is applied', async () => {
    const w = world({
      identity: () =>
        Promise.reject(heroError('provider.unavailable', { reason: 'credentials-expired' })),
    });
    const plan = await w.plan();
    await expect(w.hero.deploy(plan, await w.approval(plan), { inputs })).rejects.toMatchObject({
      code: 'provider.unavailable',
    });
    expect(w.applied).toHaveLength(0);
    expect(balanced(w.log)).toBe(true);
  });

  it('credentials that expire during the apply are a failure, not a success', async () => {
    const w = world({
      apply: () =>
        Promise.reject(
          new Error('ExpiredToken: The security token included in the request is expired'),
        ),
    });
    const plan = await w.plan();
    const error = await w.hero
      .deploy(plan, await w.approval(plan), { inputs })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(balanced(w.log)).toBe(true);
    await expect(w.hero.outputs('hero-spa')).rejects.toBeDefined();
  });

  it('a deployment that finishes but cannot be shown to work is partial, and says so', async () => {
    const w = world({
      health: () =>
        Promise.resolve({
          ...healthy,
          status: 'down',
          checks: healthy.checks.map((c) => ({ ...c, status: 'failed' as const })),
        }),
    });
    const plan = await w.plan();
    const result = await w.hero.deploy(plan, await w.approval(plan), { inputs });
    expect(result.status).toBe('partial');
    expect(result.nextSteps[0]?.code).toBe('next.check-health');
  });

  it('a health check that itself fails is partial, never healthy', async () => {
    const w = world({ health: () => Promise.reject(new Error('network unreachable')) });
    const plan = await w.plan();
    const result = await w.hero.deploy(plan, await w.approval(plan), { inputs });
    expect(result.status).not.toBe('succeeded');
    expect(result.health.status).not.toBe('healthy');
  });

  it('an approval is spent by a failed attempt, so a retry needs a new one', async () => {
    const w = world({ apply: () => Promise.reject(heroError('deployment.failed')) });
    const plan = await w.plan();
    const approval = await w.approval(plan);
    await expect(w.hero.deploy(plan, approval, { inputs })).rejects.toBeDefined();
    await expect(w.hero.deploy(plan, approval, { inputs })).rejects.toMatchObject({
      code: 'approval.unknown-challenge',
    });
  });
});
