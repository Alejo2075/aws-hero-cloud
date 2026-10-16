import { describe, expect, it } from 'vitest';
import { BOUNDARY_POLICY_NAME } from '../cdk/names.js';
import { boundaryPolicy, executionPolicy, prerequisitesTemplate } from './policies.js';
import type { PolicyDocument } from './policies.js';

const resources = (policy: PolicyDocument): string[] =>
  policy.Statement.flatMap((s) => [s.Resource].flat());

describe('the permission boundary', () => {
  it('never allows an action on every resource except decrypting through the parameter store', () => {
    const open = boundaryPolicy().Statement.filter((s) =>
      resources({ ...boundaryPolicy(), Statement: [s] }).includes('*'),
    );
    expect(open.map((s) => s.Sid)).toEqual(['DecryptParametersOnly']);
    expect(open[0]?.Condition).toBeDefined();
  });

  it('grants no identity, network, or account-level action', () => {
    const actions = boundaryPolicy().Statement.flatMap((s) => s.Action);
    expect(actions.filter((a) => /^(iam|sts|ec2|organizations|cloudformation):/.test(a))).toEqual(
      [],
    );
    expect(actions.some((a) => a === '*' || a.endsWith(':*'))).toBe(false);
  });
});

describe('the execution policy', () => {
  const policy = executionPolicy();
  const allows = policy.Statement.filter((s) => s.Effect === 'Allow');

  it('is not administrator access', () => {
    const actions = allows.flatMap((s) => s.Action);
    expect(actions).not.toContain('*');
    expect(actions.filter((a) => a.endsWith(':*'))).toEqual([]);
  });

  it('lets roles be created only under the Hero boundary', () => {
    const create = allows.find((s) => s.Action.includes('iam:CreateRole'));
    expect(create?.Condition).toEqual({
      StringEquals: {
        'iam:PermissionsBoundary': `arn:\${AWS::Partition}:iam::\${AWS::AccountId}:policy/${BOUNDARY_POLICY_NAME}`,
      },
    });
    // No statement lets a role be created or given a policy without the condition.
    for (const s of allows) {
      if (s.Sid === 'RolesUnderTheBoundary') continue;
      expect(
        s.Action.filter((a) => /^iam:(CreateRole|PutRolePolicy|AttachRolePolicy)$/.test(a)),
      ).toEqual([]);
    }
  });

  it('limits what it can reach to Hero-named resources where the service allows', () => {
    for (const s of allows) {
      if (
        [
          'Cdn',
          'LogGroupLookup',
          'Logs',
          'Identity',
          'Budget',
          'HttpApis',
          'CdkAssets',
          'WebAdapterLayer',
        ].includes(s.Sid)
      )
        continue;
      for (const r of [s.Resource].flat()) expect(r, s.Sid).toMatch(/hero-\*/);
    }
  });

  it('forbids changing the guardrails from inside a deployment', () => {
    const deny = policy.Statement.find((s) => s.Effect === 'Deny');
    expect(deny?.Action).toEqual(
      expect.arrayContaining(['iam:DeleteRolePermissionsBoundary', 'iam:CreatePolicyVersion']),
    );
  });
});

describe('the prerequisites template', () => {
  it('creates exactly the two named policies and exports their ARNs', () => {
    const template = prerequisitesTemplate() as {
      Resources: Record<string, { Type: string; Properties: { ManagedPolicyName: string } }>;
      Outputs: Record<string, unknown>;
    };
    expect(Object.values(template.Resources).map((r) => r.Properties.ManagedPolicyName)).toEqual([
      'hero-boundary',
      'hero-cfn-execution',
    ]);
    expect(Object.keys(template.Outputs)).toEqual(['BoundaryArn', 'ExecutionPolicyArn']);
    expect(JSON.stringify(template)).not.toMatch(/AdministratorAccess/);
  });
});
