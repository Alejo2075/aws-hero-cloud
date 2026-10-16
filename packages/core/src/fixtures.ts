import { sealPlan } from './digest.js';
import type { DeploymentPlan, PlanBody } from './plan.js';

/** A minimal valid plan body, shared by tests across packages. */
export function samplePlanBody(overrides: Partial<PlanBody> = {}): PlanBody {
  return {
    specVersion: '1',
    strategy: 'static',
    target: { provider: 'aws', region: 'us-east-1', accountId: '123456789012' },
    changes: [
      {
        id: 'site',
        action: 'create',
        capability: 'web-frontend',
        resource: { provider: 'aws', type: 'cloudfront-distribution', name: 'site' },
        destructive: false,
        rationale: [{ code: 'frontend.static', evidence: ['package.json:vite'] }],
      },
    ],
    warnings: [],
    requiredInputs: [],
    artifactHash: 'a'.repeat(64),
    ...overrides,
  };
}

export function samplePlan(overrides: Partial<PlanBody> = {}): DeploymentPlan {
  return sealPlan(samplePlanBody(overrides));
}
