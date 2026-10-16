import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { approvalFromChallenge, destroyArtifactHash, isHeroError } from '@hero-cloud/core';
import type { CloudProvider, DeploymentPlan, Health, ProviderApplyRequest } from '@hero-cloud/core';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import { afterEach, describe, expect, it } from 'vitest';
import { createHero } from './engine.js';

const examples = resolve(import.meta.dirname, '..', '..', '..', 'examples');
const ACCOUNT = '123456789012';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

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

function fakeCloud(over: Partial<CloudProvider> = {}) {
  const applied: ProviderApplyRequest[] = [];
  const destroyed: ProviderApplyRequest[] = [];
  const real = createAwsProvider();
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
        resources: [{ provider: 'aws', type: 'AWS::S3::Bucket', name: 'Files', id: 'bkt' }],
        sensitiveOutputs: [],
        links: [],
      });
    },
    destroy: (request) => {
      destroyed.push(request);
      return Promise.resolve({
        endpoints: [],
        resources: [],
        sensitiveOutputs: [],
        links: [],
        kept: [{ provider: 'aws', type: 'AWS::S3::Bucket', name: 'Files', id: 'bkt' }],
      });
    },
    health: () => Promise.resolve(healthy),
    ...over,
  };
  return { cloud, applied, destroyed };
}

async function ready(cloud: CloudProvider, name = 'spa', location?: string) {
  const hero = createHero({ cloud });
  const analysis = await hero.analyze({
    kind: 'directory',
    location: location ?? join(examples, name),
  });
  const plan = await hero.plan(analysis, { accountId: ACCOUNT, offline: true });
  const approve = async (p: DeploymentPlan = plan) =>
    approvalFromChallenge(await hero.requestApproval(p), 'test');
  return { hero, plan, approve };
}

const inputs = { BUDGET_ALERT_EMAIL: 'me@example.com' };

describe('deploy', () => {
  it('applies the approved plan, observes health, and records the result', async () => {
    const { cloud, applied } = fakeCloud();
    const { hero, plan, approve } = await ready(cloud);
    const result = await hero.deploy(plan, await approve(), { inputs });

    expect(applied).toHaveLength(1);
    expect(applied[0]?.parameters).toEqual({ BudgetEmail: 'me@example.com' });
    expect(applied[0]?.snapshot?.hash).toBe(plan.sourceHash);
    expect(result).toMatchObject({
      status: 'succeeded',
      planId: plan.id,
      endpoints: [{ value: 'https://d1.cloudfront.net' }],
      health: { status: 'healthy' },
    });
    expect(result.nextSteps.map((s) => s.code)).toEqual([
      'next.open-site',
      'next.watch-cost',
      'next.destroy',
    ]);
    expect(await hero.outputs(result.deploymentId)).toEqual(result);
  });

  it('reports partial, not succeeded, when health does not show the app working', async () => {
    const down: Health = { ...healthy, status: 'down' };
    const { cloud } = fakeCloud({ health: () => Promise.resolve(down) });
    const { hero, plan, approve } = await ready(cloud);
    const result = await hero.deploy(plan, await approve(), { inputs });
    expect(result.status).toBe('partial');
    expect(result.nextSteps[0]?.code).toBe('next.check-health');
  });

  it('refuses a replayed approval and applies nothing the second time', async () => {
    const { cloud, applied } = fakeCloud();
    const { hero, plan, approve } = await ready(cloud);
    const approval = await approve();
    await hero.deploy(plan, approval, { inputs });
    await expect(hero.deploy(plan, approval, { inputs })).rejects.toMatchObject({
      code: 'approval.unknown-challenge',
    });
    expect(applied).toHaveLength(1);
  });

  it('refuses a plan with a blocking warning before anything happens', async () => {
    const { cloud, applied } = fakeCloud();
    const hero = createHero({ cloud });
    const analysis = await hero.analyze({ kind: 'directory', location: join(examples, 'spa') });
    const preview = await hero.plan(analysis, { offline: true });
    await expect(
      hero.deploy(preview, {
        planId: preview.id,
        planDigest: preview.digest,
        accountId: '000000000000',
        region: 'us-east-1',
        nonce: 'x',
        channel: 'test',
        approvedAt: '',
        expiresAt: '',
      }),
    ).rejects.toMatchObject({ code: 'plan.blocking-warning' });
    expect(applied).toEqual([]);
  });

  it('stops when the credentials belong to another account', async () => {
    const { cloud, applied } = fakeCloud({
      identity: () => Promise.resolve({ account: '999999999999', principal: 'x', kind: 'role' }),
    });
    const { hero, plan, approve } = await ready(cloud);
    await expect(hero.deploy(plan, await approve(), { inputs })).rejects.toMatchObject({
      code: 'approval.account-mismatch',
    });
    expect(applied).toEqual([]);
  });

  it('asks for the spending-alert address instead of guessing one', async () => {
    const { cloud, applied } = fakeCloud();
    const { hero, plan, approve } = await ready(cloud);
    await expect(hero.deploy(plan, await approve())).rejects.toMatchObject({
      code: 'plan.missing-input',
    });
    expect(applied).toEqual([]);
  });

  it('refuses to build a source that changed after it was reviewed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hero-changed-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    await cp(join(examples, 'spa'), dir, { recursive: true });
    const { cloud, applied } = fakeCloud();
    const { hero, plan, approve } = await ready(cloud, 'spa', dir);
    await writeFile(join(dir, 'evil.js'), 'steal()');
    await expect(hero.deploy(plan, await approve(), { inputs })).rejects.toMatchObject({
      code: 'approval.plan-mismatch',
    });
    expect(applied).toEqual([]);
  });

  it('does not let two deployments of the same app run at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { cloud } = fakeCloud();
    const slow: CloudProvider = {
      ...cloud,
      apply: async (request) => {
        await gate;
        return cloud.apply!(request);
      },
    };
    const { hero, plan, approve } = await ready(slow);
    const first = hero.deploy(plan, await approve(), { inputs });
    await new Promise((r) => setTimeout(r, 50));
    await expect(hero.deploy(plan, await approve(), { inputs })).rejects.toMatchObject({
      code: 'deployment.locked',
    });
    release();
    await first;
  });

  it('does not store or return anything that looks like a secret value', async () => {
    const { cloud } = fakeCloud();
    const { hero, plan, approve } = await ready(cloud);
    const result = await hero.deploy(plan, await approve(), { inputs });
    expect(JSON.stringify(result)).not.toContain('me@example.com');
  });
});

describe('health and outputs', () => {
  it('re-checks health on demand and keeps the latest evidence', async () => {
    let status: Health['status'] = 'healthy';
    const { cloud } = fakeCloud({ health: () => Promise.resolve({ ...healthy, status }) });
    const { hero, plan, approve } = await ready(cloud);
    const deployed = await hero.deploy(plan, await approve(), { inputs });
    status = 'degraded';
    expect((await hero.health(deployed.deploymentId)).status).toBe('degraded');
    expect((await hero.outputs(deployed.deploymentId)).health.status).toBe('degraded');
  });

  it('says it does not know a deployment it never made', async () => {
    const hero = createHero({ cloud: fakeCloud().cloud });
    await expect(hero.outputs('hero-nothing')).rejects.toMatchObject({ code: 'plan.unknown' });
    await expect(hero.health('hero-nothing')).rejects.toMatchObject({ code: 'plan.unknown' });
    await expect(hero.planDestroy('hero-nothing')).rejects.toMatchObject({ code: 'plan.unknown' });
  });
});

describe('destroy', () => {
  it('is a plan that needs approval, shows every removal as destructive, and covers the deployed bundle', async () => {
    const { cloud, destroyed } = fakeCloud();
    const { hero, plan, approve } = await ready(cloud);
    const deployed = await hero.deploy(plan, await approve(), { inputs });

    const destroyPlan = await hero.planDestroy(deployed.deploymentId);
    expect(destroyPlan).toMatchObject({
      intent: 'destroy',
      deploymentId: deployed.deploymentId,
      artifactHash: destroyArtifactHash(deployed.deploymentId, plan.artifactHash),
    });
    expect(destroyPlan.changes.length).toBeGreaterThan(0);
    expect(destroyPlan.changes.every((c) => c.action === 'delete' && c.destructive)).toBe(true);
    expect(destroyPlan.warnings.map((w) => w.code)).toEqual(['plan.destroy-keeps-data']);

    // Nothing is removed until a person approves.
    expect(destroyed).toEqual([]);
    const result = await hero.deploy(destroyPlan, await approve(destroyPlan));
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]?.deployedArtifactHash).toBe(plan.artifactHash);
    expect(result.resources).toHaveLength(1);
    expect(result.nextSteps.map((s) => s.code)).toEqual(['next.review-kept-data']);
    await expect(hero.health(deployed.deploymentId)).rejects.toMatchObject({
      code: 'plan.unknown',
    });
  });

  it('is refused when the provider cannot remove things', async () => {
    const { cloud } = fakeCloud();
    const withoutDestroy = Object.fromEntries(
      Object.entries(cloud).filter(([key]) => key !== 'destroy'),
    ) as unknown as CloudProvider;
    const { hero, plan, approve } = await ready(withoutDestroy);
    const deployed = await hero.deploy(plan, await approve(), { inputs });
    const destroyPlan = await hero.planDestroy(deployed.deploymentId);
    await expect(hero.deploy(destroyPlan, await approve(destroyPlan))).rejects.toSatisfy(
      (e: unknown) => isHeroError(e) && e.code === 'provider.unavailable',
    );
  });
});
