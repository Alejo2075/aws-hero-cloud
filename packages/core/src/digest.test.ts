import { describe, expect, it } from 'vitest';
import { computePlanDigest, isSealIntact, sealPlan } from './digest.js';
import { samplePlanBody } from './fixtures.js';

describe('sealPlan', () => {
  it('is deterministic: the same body gives the same digest and id', () => {
    const a = sealPlan(samplePlanBody());
    const b = sealPlan(samplePlanBody());
    expect(a).toEqual(b);
    expect(a.id).toBe(`plan_${a.digest.slice(0, 24)}`);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on key order', () => {
    const body = samplePlanBody();
    const shuffled = {
      artifactHash: body.artifactHash,
      requiredInputs: body.requiredInputs,
      warnings: body.warnings,
      changes: body.changes,
      target: { accountId: body.target.accountId, region: body.target.region, provider: 'aws' },
      strategy: body.strategy,
      specVersion: body.specVersion,
    };
    expect(computePlanDigest(shuffled)).toBe(computePlanDigest(body));
  });

  it.each([
    ['the artifact hash (D1)', samplePlanBody({ artifactHash: 'b'.repeat(64) })],
    [
      'the account',
      samplePlanBody({
        target: { provider: 'aws', region: 'us-east-1', accountId: '999999999999' },
      }),
    ],
    [
      'the region',
      samplePlanBody({
        target: { provider: 'aws', region: 'eu-west-1', accountId: '123456789012' },
      }),
    ],
    ['the strategy', samplePlanBody({ strategy: 'serverless' })],
    ['the changes', samplePlanBody({ changes: [] })],
    ['a warning', samplePlanBody({ warnings: [{ code: 'public-exposure', severity: 'warning' }] })],
  ])('changes the digest when %s changes', (_label, other) => {
    expect(computePlanDigest(other)).not.toBe(computePlanDigest(samplePlanBody()));
  });
});

describe('isSealIntact', () => {
  it('accepts a sealed plan and detects any alteration after sealing', () => {
    const plan = sealPlan(samplePlanBody());
    expect(isSealIntact(plan)).toBe(true);
    expect(isSealIntact({ ...plan, strategy: 'serverless' })).toBe(false);
    expect(isSealIntact({ ...plan, artifactHash: 'c'.repeat(64) })).toBe(false);
    expect(isSealIntact({ ...plan, digest: 'd'.repeat(64) })).toBe(false);
    expect(isSealIntact({ ...plan, id: 'plan_forged' })).toBe(false);
  });
});
