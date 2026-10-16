import { canonicalJson, digestsEqual, sha256Hex } from '@hero-cloud/shared';
import type { DeploymentPlan, PlanBody } from './plan.js';

const ID_PREFIX = 'plan_';

/** SHA-256 over the RFC 8785 canonical JSON of the plan body. */
export function computePlanDigest(body: PlanBody): string {
  return sha256Hex(canonicalJson(body));
}

/** Seals a plan body: derives the digest and the id. The same body always gives the same plan. */
export function sealPlan(body: PlanBody): DeploymentPlan {
  const digest = computePlanDigest(body);
  return { ...body, id: `${ID_PREFIX}${digest.slice(0, 24)}`, digest };
}

/** True when a plan's digest and id match its body, that is, nothing was altered after sealing. */
export function isSealIntact(plan: DeploymentPlan): boolean {
  const { id, digest, ...body } = plan;
  const expected = computePlanDigest(body);
  return digestsEqual(expected, digest) && id === `${ID_PREFIX}${expected.slice(0, 24)}`;
}
