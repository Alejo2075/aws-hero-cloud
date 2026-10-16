import type { StackStatus } from '@aws-sdk/client-cloudformation';
import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
} from '@aws-sdk/client-cloudformation';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, expect, it } from 'vitest';
import { createBootstrapper, describeBootstrap } from './bootstrapper.js';
import type { BootstrapToolkit } from './bootstrapper.js';

const target = { accountId: '123456789012', region: 'us-east-1' };
const ARN = 'arn:aws:iam::123456789012:policy/hero-cfn-execution';

const complete = (status: StackStatus) => ({
  Stacks: [
    {
      StackName: 'hero-prerequisites',
      StackStatus: status,
      CreationTime: new Date(),
      Outputs: [{ OutputKey: 'ExecutionPolicyArn', OutputValue: ARN }],
    },
  ],
});

function toolkit() {
  const calls: unknown[] = [];
  const port: BootstrapToolkit = {
    bootstrap: (options) => {
      calls.push(options);
      return Promise.resolve();
    },
  };
  return { calls, factory: () => Promise.resolve(port) };
}

describe('describeBootstrap', () => {
  it('lists the boundary, the limited execution policy, and the toolkit stack', () => {
    const { changes, artifactHash } = describeBootstrap(target);
    expect(changes.map((c) => c.resource.name)).toEqual([
      'hero-boundary',
      'hero-cfn-execution',
      'CDKToolkit-herocloud',
    ]);
    expect(changes.every((c) => !c.destructive && c.action === 'create')).toBe(true);
    expect(changes[1]?.details).toMatchObject({ replaces: 'AdministratorAccess' });
    expect(artifactHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds the hash to the account and region', () => {
    const a = describeBootstrap(target).artifactHash;
    expect(describeBootstrap({ ...target, region: 'eu-west-1' }).artifactHash).not.toBe(a);
    expect(describeBootstrap({ ...target, accountId: '210987654321' }).artifactHash).not.toBe(a);
    expect(describeBootstrap(target).artifactHash).toBe(a);
  });
});

describe('createBootstrapper', () => {
  const approvedRequest = () => ({
    ...target,
    artifactHash: describeBootstrap(target).artifactHash,
    approved: true,
  });

  it('creates the policies, then bootstraps with them and the boundary', async () => {
    const cfn = mockClient(CloudFormationClient);
    cfn
      .on(DescribeStacksCommand)
      .rejectsOnce(new Error('Stack with id hero-prerequisites does not exist'))
      .resolves(complete('CREATE_COMPLETE'));
    cfn.on(CreateStackCommand).resolves({ StackId: 'x' });
    const { calls, factory } = toolkit();
    try {
      const result = await createBootstrapper({
        region: 'us-east-1',
        cloudFormation: new CloudFormationClient({ region: 'us-east-1' }),
        toolkit: factory,
      }).run(approvedRequest());
      expect(result.executionPolicyArn).toBe(ARN);
      const create = cfn.commandCalls(CreateStackCommand)[0]?.args[0].input;
      expect(create).toMatchObject({
        StackName: 'hero-prerequisites',
        Capabilities: ['CAPABILITY_NAMED_IAM'],
        EnableTerminationProtection: true,
      });
      expect(calls).toEqual([
        {
          environment: 'aws://123456789012/us-east-1',
          qualifier: 'herocloud',
          executionPolicyArns: [ARN],
          permissionsBoundaryName: 'hero-boundary',
        },
      ]);
    } finally {
      cfn.restore();
    }
  });

  it('updates an existing stack and treats "no updates" as success', async () => {
    const cfn = mockClient(CloudFormationClient);
    cfn.on(DescribeStacksCommand).resolves(complete('CREATE_COMPLETE'));
    cfn.on(UpdateStackCommand).rejects(new Error('No updates are to be performed.'));
    const { calls, factory } = toolkit();
    try {
      await createBootstrapper({
        region: 'us-east-1',
        cloudFormation: new CloudFormationClient({ region: 'us-east-1' }),
        toolkit: factory,
      }).run(approvedRequest());
      expect(cfn.commandCalls(CreateStackCommand)).toHaveLength(0);
      expect(calls).toHaveLength(1);
    } finally {
      cfn.restore();
    }
  });

  it('does nothing without an approval or with a hash that is not the approved one', async () => {
    const cfn = mockClient(CloudFormationClient);
    const { calls, factory } = toolkit();
    const bootstrapper = createBootstrapper({
      region: 'us-east-1',
      cloudFormation: new CloudFormationClient({ region: 'us-east-1' }),
      toolkit: factory,
    });
    try {
      await expect(bootstrapper.run({ ...approvedRequest(), approved: false })).rejects.toThrow();
      await expect(
        bootstrapper.run({ ...approvedRequest(), artifactHash: '0'.repeat(64) }),
      ).rejects.toMatchObject({ code: 'approval.plan-mismatch' });
      expect(cfn.calls()).toHaveLength(0);
      expect(calls).toEqual([]);
    } finally {
      cfn.restore();
    }
  });

  it('reports a failed call as deployment.failed', async () => {
    const cfn = mockClient(CloudFormationClient);
    cfn.on(DescribeStacksCommand).rejects(new Error('AccessDenied'));
    try {
      await expect(
        createBootstrapper({
          region: 'us-east-1',
          cloudFormation: new CloudFormationClient({ region: 'us-east-1' }),
          toolkit: toolkit().factory,
        }).run(approvedRequest()),
      ).rejects.toMatchObject({ code: 'deployment.failed' });
    } finally {
      cfn.restore();
    }
  });
});
