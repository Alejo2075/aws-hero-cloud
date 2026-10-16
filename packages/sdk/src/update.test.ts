import { join, resolve } from 'node:path';
import { approvalFromChallenge, heroError } from '@hero-cloud/core';
import type {
  CloudProvider,
  DeploymentLock,
  HeroEvent,
  PlanChange,
  SecretSink,
} from '@hero-cloud/core';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import { describe, expect, it } from 'vitest';
import { createHero } from './engine.js';

const examples = resolve(import.meta.dirname, '..', '..', '..', 'examples');
const ACCOUNT = '123456789012';
const inputs = { BUDGET_ALERT_EMAIL: 'me@example.com' };

function world(
  diff?: CloudProvider['diff'],
  extra: { secrets?: SecretSink; locks?: DeploymentLock } = {},
) {
  const real = createAwsProvider();
  const applied: number[] = [];
  const cloud: CloudProvider = {
    id: 'aws',
    describe: (r) => real.describe(r),
    identity: () => Promise.resolve({ account: ACCOUNT, principal: 'arn:test', kind: 'role' }),
    apply: () => {
      applied.push(1);
      return Promise.resolve({ endpoints: [], resources: [], sensitiveOutputs: [], links: [] });
    },
    ...(diff === undefined ? {} : { diff }),
  };
  const events: HeroEvent[] = [];
  const hero = createHero({ cloud, ...extra });
  hero.subscribe((e) => events.push(e));
  return { hero, applied, events };
}

async function planOf(hero: ReturnType<typeof world>['hero'], offline = false) {
  const analysis = await hero.analyze({
    kind: 'directory',
    location: join(examples, 'api-dynamodb'),
  });
  return hero.plan(analysis, { accountId: ACCOUNT, offline });
}

async function deployed(w: ReturnType<typeof world>, secrets?: Record<string, string>) {
  const plan = await planOf(w.hero, true);
  const approval = approvalFromChallenge(await w.hero.requestApproval(plan), 'test');
  const result = await w.hero.deploy(plan, approval, {
    inputs,
    ...(secrets === undefined ? {} : { secrets }),
  });
  return { plan, result };
}

describe('planning an update', () => {
  it('does not ask the cloud for a diff before anything is deployed', async () => {
    let asked = 0;
    const w = world(() => {
      asked += 1;
      return Promise.resolve([]);
    });
    const plan = await planOf(w.hero);
    expect(asked).toBe(0);
    expect(plan.warnings.map((x) => x.code)).not.toContain('plan.update-unverified');
  });

  it('shows what will really change, and flags a replacement', async () => {
    const asks: { fresh: number }[] = [];
    const w = world((request) => {
      asks.push({ fresh: request.fresh.length });
      const table = request.fresh.find((c) => c.resource.type === 'dynamodb-table');
      const changes: PlanChange[] =
        table === undefined ? [] : [{ ...table, action: 'replace', destructive: true }];
      return Promise.resolve(changes);
    });
    await deployed(w);
    const update = await planOf(w.hero);
    expect(asks).toHaveLength(1);
    expect(update.changes.map((c) => [c.resource.type, c.action, c.destructive])).toEqual([
      ['dynamodb-table', 'replace', true],
    ]);
    const warning = update.warnings.find((x) => x.code === 'plan.destructive-changes');
    expect(warning).toMatchObject({ severity: 'warning', params: { count: 1 } });
    expect(update.warnings.map((x) => x.code)).not.toContain('plan.update-unverified');
  });

  it('says so when it could not compare with what exists, instead of calling everything new', async () => {
    const offline = world(() => Promise.resolve([]));
    await deployed(offline);
    const a = await planOf(offline.hero, true);
    expect(a.warnings.find((x) => x.code === 'plan.update-unverified')?.params).toEqual({
      reason: 'offline',
    });

    const failing = world(() => Promise.reject(new Error('AccessDenied')));
    await deployed(failing);
    const b = await planOf(failing.hero);
    expect(b.warnings.find((x) => x.code === 'plan.update-unverified')?.params).toEqual({
      reason: 'failed',
    });
    expect(b.changes.length).toBeGreaterThan(0);

    const none = world();
    await deployed(none);
    const c = await planOf(none.hero);
    expect(c.warnings.find((x) => x.code === 'plan.update-unverified')?.params).toEqual({
      reason: 'unsupported',
    });
  });
});

describe('secrets', () => {
  function sink() {
    const puts: { deploymentId: string; name: string; kind?: string }[] = [];
    const seen: string[] = [];
    const secrets: SecretSink = {
      put: (r) => {
        puts.push({
          deploymentId: r.deploymentId,
          name: r.name,
          ...(r.kind === undefined ? {} : { kind: r.kind }),
        });
        seen.push(r.value);
        return Promise.resolve({ name: r.name, location: `ssm:/hero/${r.deploymentId}/${r.name}` });
      },
    };
    return { secrets, puts, seen };
  }

  it('go straight to the secret store before the app is applied, and nowhere else', async () => {
    const s = sink();
    const order: string[] = [];
    const w = world(undefined, {
      secrets: {
        put: (r) => {
          order.push('secret');
          return s.secrets.put(r);
        },
      },
    });
    const { result } = await deployed(w, { API_KEY: 'sk_live_topsecret' });
    expect(s.puts).toEqual([
      { deploymentId: result.deploymentId, name: 'API_KEY', kind: 'secret' },
    ]);
    expect(s.seen).toEqual(['sk_live_topsecret']);
    const everything = JSON.stringify([
      result,
      w.events,
      await w.hero.outputs(result.deploymentId),
    ]);
    expect(everything).not.toContain('sk_live_topsecret');
    expect(order).toEqual(['secret']);
  });

  it('are refused for names the plan did not ask for, before anything is applied', async () => {
    const s = sink();
    const w = world(undefined, { secrets: s.secrets });
    const plan = await planOf(w.hero, true);
    const approval = approvalFromChallenge(await w.hero.requestApproval(plan), 'test');
    await expect(
      w.hero.deploy(plan, approval, { inputs, secrets: { SOMETHING_ELSE: 'x' } }),
    ).rejects.toMatchObject({ code: 'plan.invalid-answer' });
    expect(s.puts).toEqual([]);
    expect(w.applied).toEqual([]);
  });

  it('can be set later for a deployment that exists, for the names it asked for', async () => {
    const s = sink();
    const w = world(undefined, { secrets: s.secrets });
    const { result } = await deployed(w);
    await expect(w.hero.setSecret(result.deploymentId, 'API_KEY', 'v1')).resolves.toEqual({
      name: 'API_KEY',
      location: `ssm:/hero/${result.deploymentId}/API_KEY`,
    });
    await expect(w.hero.setSecret(result.deploymentId, 'NOPE', 'v')).rejects.toMatchObject({
      code: 'plan.invalid-answer',
    });
    await expect(w.hero.setSecret('hero-unknown', 'API_KEY', 'v')).rejects.toMatchObject({
      code: 'plan.unknown',
    });
  });

  it('need a sink when the cloud is not the built-in one', async () => {
    const w = world();
    const { result } = await deployed(w);
    await expect(w.hero.setSecret(result.deploymentId, 'API_KEY', 'v')).rejects.toMatchObject({
      code: 'provider.unavailable',
    });
  });
});

describe('locks', () => {
  function locks() {
    const log: string[] = [];
    const lock: DeploymentLock = {
      acquire: (id) => {
        log.push(`acquire:${id}`);
        return Promise.resolve(() => {
          log.push(`release:${id}`);
          return Promise.resolve();
        });
      },
    };
    return { lock, log };
  }

  it('hold the deployment while it changes and let go afterwards, even after a failure', async () => {
    const { lock, log } = locks();
    const w = world(undefined, { locks: lock });
    const { result } = await deployed(w);
    expect(log).toEqual([`acquire:${result.deploymentId}`, `release:${result.deploymentId}`]);

    const failing = locks();
    const f = world(undefined, { locks: failing.lock });
    const plan = await planOf(f.hero, true);
    const approval = approvalFromChallenge(await f.hero.requestApproval(plan), 'test');
    await expect(
      f.hero.deploy(plan, approval, { inputs, secrets: { NOPE: 'x' } }),
    ).rejects.toThrow();
    expect(failing.log.filter((l) => l.startsWith('release'))).toHaveLength(
      failing.log.filter((l) => l.startsWith('acquire')).length,
    );
  });

  it('refuse a deployment another process holds', async () => {
    const busy: DeploymentLock = { acquire: () => Promise.reject(heroError('deployment.locked')) };
    const w = world(undefined, { locks: busy });
    const plan = await planOf(w.hero, true);
    const approval = approvalFromChallenge(await w.hero.requestApproval(plan), 'test');
    await expect(w.hero.deploy(plan, approval, { inputs })).rejects.toMatchObject({
      code: 'deployment.locked',
    });
    expect(w.applied).toEqual([]);
  });
});
