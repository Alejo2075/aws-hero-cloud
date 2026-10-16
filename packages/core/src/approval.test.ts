import { describe, expect, it } from 'vitest';
import { ApprovalService, InMemoryChallengeStore, approvalFromChallenge } from './approval.js';
import type { Approval } from './approval.js';
import { sealPlan } from './digest.js';
import { samplePlan, samplePlanBody } from './fixtures.js';

function setup(ttlMs = 60_000) {
  let now = new Date('2026-01-01T00:00:00Z');
  const clock = { now: () => now };
  let counter = 0;
  const service = new ApprovalService({
    clock,
    ttlMs,
    store: new InMemoryChallengeStore(),
    randomNonce: () => `nonce-${++counter}`,
  });
  return {
    service,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    plan: samplePlan(),
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('ApprovalService', () => {
  it('accepts an approval made from a live challenge for the same plan', async () => {
    const { service, plan } = setup();
    const challenge = await service.issue(plan);
    const approval = approvalFromChallenge(challenge, 'cli');
    await expect(service.consume(plan, approval)).resolves.toBeUndefined();
  });

  it('never stores the nonce, only a hash', async () => {
    const store = new InMemoryChallengeStore();
    const service = new ApprovalService({ store, randomNonce: () => 'super-secret-nonce' });
    await service.issue(samplePlan());
    const taken = await store.take('super-secret-nonce');
    expect(taken).toBeUndefined();
  });

  it('refuses a replayed approval: a challenge is single use', async () => {
    const { service, plan } = setup();
    const approval = approvalFromChallenge(await service.issue(plan), 'cli');
    await service.consume(plan, approval);
    await expectCode(service.consume(plan, approval), 'approval.unknown-challenge');
  });

  it('refuses a fabricated approval with a guessed nonce (D2)', async () => {
    const { service, plan } = setup();
    await service.issue(plan);
    const forged: Approval = {
      planId: plan.id,
      planDigest: plan.digest,
      accountId: plan.target.accountId,
      region: plan.target.region,
      nonce: 'guessed',
      channel: 'attacker',
      approvedAt: new Date().toISOString(),
      expiresAt: '2999-01-01T00:00:00Z',
    };
    await expectCode(service.consume(plan, forged), 'approval.unknown-challenge');
  });

  it('refuses an expired approval', async () => {
    const { service, plan, advance } = setup(1000);
    const approval = approvalFromChallenge(await service.issue(plan), 'cli');
    advance(1001);
    await expectCode(service.consume(plan, approval), 'approval.expired');
  });

  it('refuses an approval used for a different plan', async () => {
    const { service, plan } = setup();
    const other = sealPlan(samplePlanBody({ strategy: 'serverless' }));
    const approval = approvalFromChallenge(await service.issue(plan), 'cli');
    await expectCode(service.consume(other, approval), 'approval.plan-mismatch');
  });

  it('refuses an approval whose digest was altered', async () => {
    const { service, plan } = setup();
    const approval = approvalFromChallenge(await service.issue(plan), 'cli');
    await expectCode(
      service.consume(plan, { ...approval, planDigest: 'f'.repeat(64) }),
      'approval.digest-mismatch',
    );
  });

  it('refuses an approval for another account or region', async () => {
    const a = setup();
    const approvalA = approvalFromChallenge(await a.service.issue(a.plan), 'cli');
    await expectCode(
      a.service.consume(a.plan, { ...approvalA, accountId: '000000000000' }),
      'approval.account-mismatch',
    );
    const b = setup();
    const approvalB = approvalFromChallenge(await b.service.issue(b.plan), 'cli');
    await expectCode(
      b.service.consume(b.plan, { ...approvalB, region: 'eu-west-1' }),
      'approval.region-mismatch',
    );
  });

  it('consumes the challenge even when verification fails', async () => {
    const { service, plan } = setup();
    const approval = approvalFromChallenge(await service.issue(plan), 'cli');
    await expectCode(
      service.consume(plan, { ...approval, planDigest: 'f'.repeat(64) }),
      'approval.digest-mismatch',
    );
    await expectCode(service.consume(plan, approval), 'approval.unknown-challenge');
  });
});
