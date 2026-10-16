/**
 * Rationale codes the planner can attach to a decision. Each has a message at every audience level
 * under `rationale.<code>`, and a test fails the build if one is missing.
 */
export const plannerRationaleCodes = [
  'strategy.static',
  'strategy.serverless',
  'strategy.needs-container',
  'frontend.static-site',
  'service.http.serverless',
  'service.scheduled.serverless',
  'data.key-value.on-demand',
  'storage.object.private',
  'auth.user-pool',
  'guardrail.budget',
  'input.secret',
  'input.config',
  'input.budget-email',
] as const;

export type PlannerRationaleCode = (typeof plannerRationaleCodes)[number];
