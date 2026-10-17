import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from '@aws-sdk/client-cloudformation';
import { heroError } from '@hero-cloud/core';
import type { PlanChange } from '@hero-cloud/core';
import { canonicalJson, sha256Hex } from '@hero-cloud/shared';
import { BOOTSTRAP_QUALIFIER, BOUNDARY_POLICY_NAME } from '../cdk/names.js';
import {
  DEPLOYER_POLICY_NAME,
  DEPLOYER_ROLE_NAME,
  EXECUTION_POLICY_NAME,
  PREREQUISITES_STACK,
  boundaryPolicy,
  deployerPolicy,
  executionPolicies,
  executionPolicy,
  prerequisitesTemplate,
} from './policies.js';

/** The CDK Toolkit stack Hero owns, kept apart from any `CDKToolkit` the user already has. */
export const TOOLKIT_STACK = 'CDKToolkit-herocloud';

export interface BootstrapTarget {
  readonly accountId: string;
  readonly region: string;
}

/** What preparing an account will create, listed like any other plan so a person can review it. */
export interface BootstrapDescription {
  readonly changes: readonly PlanChange[];
  /** Hash of the policies, qualifier, account and region. Approval is bound to it. */
  readonly artifactHash: string;
}

export function describeBootstrap(target: BootstrapTarget): BootstrapDescription {
  const tags = { 'hero:deployment-id': 'hero-bootstrap' };
  const change = (
    id: string,
    type: string,
    name: string,
    capability: string,
    codes: readonly string[],
    details: Record<string, unknown>,
  ): PlanChange => ({
    id: `bootstrap:${id}`,
    action: 'create',
    capability,
    resource: { provider: 'aws', type, name },
    destructive: false,
    rationale: codes.map((code) => ({ code })),
    details: { ...details, region: target.region, tags },
  });
  const boundary = boundaryPolicy();
  const execution = executionPolicy();
  const changes = [
    change(
      'boundary',
      'iam-policy',
      BOUNDARY_POLICY_NAME,
      'account-setup',
      ['guardrail.least-privilege'],
      { statements: boundary.Statement.map((s) => s.Sid) },
    ),
    change(
      'execution',
      'iam-policy',
      `${EXECUTION_POLICY_NAME}-*`,
      'account-setup',
      ['guardrail.least-privilege'],
      {
        statements: execution.Statement.map((s) => s.Sid),
        parts: executionPolicies().map((p) => p.suffix),
        replaces: 'AdministratorAccess',
      },
    ),
    change(
      'deployer-policy',
      'iam-policy',
      DEPLOYER_POLICY_NAME,
      'account-setup',
      ['guardrail.least-privilege'],
      { statements: deployerPolicy().Statement.map((s) => s.Sid) },
    ),
    change(
      'deployer',
      'iam-role',
      DEPLOYER_ROLE_NAME,
      'account-setup',
      ['guardrail.least-privilege'],
      { assumableBy: 'principals in this account that are allowed to assume it' },
    ),
    change(
      'toolkit',
      'cloudformation-stack',
      TOOLKIT_STACK,
      'account-setup',
      ['guardrail.private-by-default', 'guardrail.encryption'],
      { qualifier: BOOTSTRAP_QUALIFIER },
    ),
  ];
  const artifactHash = sha256Hex(
    canonicalJson({
      qualifier: BOOTSTRAP_QUALIFIER,
      account: target.accountId,
      region: target.region,
      prerequisites: prerequisitesTemplate(),
    }),
  );
  return { changes, artifactHash };
}

/** The part of the CloudFormation client Hero uses, so tests can use a mock. */
export type CloudFormationPort = Pick<CloudFormationClient, 'send'>;

/** The part of the CDK Toolkit used to bootstrap. */
export interface BootstrapToolkit {
  bootstrap(options: {
    readonly environment: string;
    readonly qualifier: string;
    readonly executionPolicyArns: readonly string[];
    readonly permissionsBoundaryName: string;
  }): Promise<void>;
}

export interface BootstrapperOptions {
  readonly region: string;
  readonly cloudFormation?: CloudFormationPort;
  readonly toolkit?: () => Promise<BootstrapToolkit>;
  readonly profile?: string;
}

export interface BootstrapRequest extends BootstrapTarget {
  readonly artifactHash: string;
  readonly approved: boolean;
}

async function stackStatus(cfn: CloudFormationPort, name: string): Promise<string | undefined> {
  try {
    const result = await cfn.send(new DescribeStacksCommand({ StackName: name }));
    return result.Stacks?.[0]?.StackStatus;
  } catch (error) {
    if (error instanceof Error && /does not exist/i.test(error.message)) return undefined;
    throw error;
  }
}

/** Creates the limited policies, then the CDK toolkit stack that uses them. */
export function createBootstrapper(options: BootstrapperOptions): {
  run(request: BootstrapRequest): Promise<{
    readonly executionPolicyArns: readonly string[];
    readonly deployerRoleArn: string | undefined;
  }>;
} {
  const cfn: CloudFormationPort =
    options.cloudFormation ??
    new CloudFormationClient({
      region: options.region,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    });

  return {
    async run(request) {
      if (!request.approved) throw heroError('approval.unknown-challenge');
      if (describeBootstrap(request).artifactHash !== request.artifactHash) {
        throw heroError('approval.plan-mismatch', { reason: 'bootstrap-hash' });
      }
      try {
        const existing = await stackStatus(cfn, PREREQUISITES_STACK);
        const body = JSON.stringify(prerequisitesTemplate());
        const input = {
          StackName: PREREQUISITES_STACK,
          TemplateBody: body,
          Capabilities: ['CAPABILITY_NAMED_IAM' as const],
          Tags: [{ Key: 'hero:deployment-id', Value: 'hero-bootstrap' }],
        };
        const wait = { client: cfn as CloudFormationClient, maxWaitTime: 600 };
        if (existing === undefined) {
          await cfn.send(new CreateStackCommand({ ...input, EnableTerminationProtection: true }));
          await waitUntilStackCreateComplete(wait, { StackName: PREREQUISITES_STACK });
        } else {
          try {
            await cfn.send(new UpdateStackCommand(input));
            await waitUntilStackUpdateComplete(wait, { StackName: PREREQUISITES_STACK });
          } catch (error) {
            if (!(
              error instanceof Error && /No updates are to be performed/i.test(error.message)
            )) {
              throw error;
            }
          }
        }
        const described = await cfn.send(
          new DescribeStacksCommand({ StackName: PREREQUISITES_STACK }),
        );
        const executionArns = (described.Stacks?.[0]?.Outputs ?? [])
          .filter((o) => o.OutputKey?.startsWith('ExecutionPolicyArn') === true)
          .flatMap((o) => (o.OutputValue === undefined ? [] : [o.OutputValue]))
          .sort();
        if (executionArns.length === 0) throw new Error('prerequisites stack has no policy output');

        const toolkit = await (options.toolkit ?? realToolkit(options.region, options.profile))();
        await toolkit.bootstrap({
          environment: `aws://${request.accountId}/${request.region}`,
          qualifier: BOOTSTRAP_QUALIFIER,
          executionPolicyArns: executionArns,
          permissionsBoundaryName: BOUNDARY_POLICY_NAME,
        });
        const deployerRoleArn = described.Stacks?.[0]?.Outputs?.find(
          (o) => o.OutputKey === 'DeployerRoleArn',
        )?.OutputValue;
        return { executionPolicyArns: executionArns, deployerRoleArn };
      } catch (error) {
        if (error instanceof Error && 'code' in error) throw error;
        throw heroError('deployment.failed', { stack: TOOLKIT_STACK }, error);
      }
    },
  };
}

function realToolkit(region: string, profile: string | undefined): () => Promise<BootstrapToolkit> {
  return async () => {
    const { Toolkit, BaseCredentials, BootstrapEnvironments, BootstrapStackParameters } =
      await import('@aws-cdk/toolkit-lib');
    const toolkit = new Toolkit({
      toolkitStackName: TOOLKIT_STACK,
      ioHost: {
        notify: () => Promise.resolve(),
        // Bootstrapping asks nothing a person has not already approved in the plan.
        requestResponse: (message) => Promise.resolve(message.defaultResponse),
      },
      sdkConfig: {
        baseCredentials: BaseCredentials.awsCliCompatible({
          defaultRegion: region,
          ...(profile === undefined ? {} : { profile }),
        }),
      },
    });
    return {
      async bootstrap(request) {
        await toolkit.bootstrap(BootstrapEnvironments.fromList([request.environment]), {
          parameters: BootstrapStackParameters.exactly({
            qualifier: request.qualifier,
            cloudFormationExecutionPolicies: [...request.executionPolicyArns],
            customPermissionsBoundary: request.permissionsBoundaryName,
            trustedAccounts: [],
            publicAccessBlockConfiguration: true,
          }),
          terminationProtection: true,
        });
      },
    };
  };
}
