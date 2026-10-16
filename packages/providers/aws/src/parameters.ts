import type { PlanChange } from '@hero-cloud/core';

/**
 * One place per input the application reads. Hero writes the values straight into the user's own
 * parameter store when it deploys; they are never part of the infrastructure template, so they can
 * never end up in a template, a plan, a log, or local state.
 */
export function parameterChanges(
  inputs: readonly { readonly name: string; readonly kind: 'secret' | 'config' }[],
  region: string,
  deploymentId: string,
  path: string,
): PlanChange[] {
  return [...inputs]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((input) => ({
      id: `input:ssm-parameter:${input.name}`,
      action: 'create' as const,
      capability: 'environment-variables',
      resource: { provider: 'aws', type: 'ssm-parameter', name: input.name },
      destructive: false,
      rationale:
        input.kind === 'secret'
          ? [{ code: 'guardrail.secret-store' }, { code: 'guardrail.encryption' }]
          : [],
      details: {
        path: `${path}${input.name}`,
        type: input.kind === 'secret' ? 'SecureString' : 'String',
        value: 'supplied-at-deploy',
        region,
        tags: { 'hero:deployment-id': deploymentId },
      },
    }));
}
