import { DescribeStacksCommand, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import type { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import type {
  DeployedResource,
  Endpoint,
  OperationLink,
  ProviderOutputs,
  SensitiveOutput,
} from '@hero-cloud/core';
import { parameterPath, pascal } from '../cdk/names.js';
import type { CfnTemplate } from '../cdk/synth.js';

export type CloudFormationPort = Pick<CloudFormationClient, 'send'>;

/** Reads a deployed stack's outputs. Outputs never hold secrets, by construction. */
export async function readStackOutputs(
  cfn: CloudFormationPort,
  stackName: string,
): Promise<Record<string, string>> {
  const result = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const outputs: Record<string, string> = {};
  for (const output of result.Stacks?.[0]?.Outputs ?? []) {
    if (output.OutputKey !== undefined && output.OutputValue !== undefined) {
      outputs[output.OutputKey] = output.OutputValue;
    }
  }
  return outputs;
}

/** Every resource of a deployed stack, by the name and identifier AWS gives it. */
export async function listDeployedResources(
  cfn: CloudFormationPort,
  stackName: string,
): Promise<DeployedResource[]> {
  const resources: DeployedResource[] = [];
  let token: string | undefined;
  do {
    const page = await cfn.send(
      new ListStackResourcesCommand({
        StackName: stackName,
        ...(token === undefined ? {} : { NextToken: token }),
      }),
    );
    for (const item of page.StackResourceSummaries ?? []) {
      if (item.ResourceType === undefined || item.LogicalResourceId === undefined) continue;
      resources.push({
        provider: 'aws',
        type: item.ResourceType,
        name: item.LogicalResourceId,
        id: item.PhysicalResourceId ?? item.LogicalResourceId,
      });
    }
    token = page.NextToken;
  } while (token !== undefined);
  return resources.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Resources the template keeps when the stack is removed, so a person knows what stays. */
export function retainedResources(
  template: CfnTemplate,
  deployed: readonly DeployedResource[],
): DeployedResource[] {
  const retained = new Set(
    Object.entries(template.Resources)
      .filter(
        ([, entry]) => entry.DeletionPolicy === 'Retain' || entry.DeletionPolicy === 'Snapshot',
      )
      .map(([logicalId]) => logicalId),
  );
  return deployed.filter((resource) => retained.has(resource.name));
}

/**
 * Turns stack outputs named `<Kind><Id>Url` into the places the application can be reached. The
 * label is the Hero Spec id of the component so each interface can word it for its reader.
 */
export function endpointsFromOutputs(
  outputs: Readonly<Record<string, string>>,
  ids: readonly { readonly id: string; readonly kind: string }[],
): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const { id, kind } of ids) {
    // A container deployment has one address for all of it, kept with the shared network.
    const prefix =
      kind === 'container-service'
        ? 'ContainerServicePlatform'
        : `${kind === 'static-site' ? 'StaticSite' : 'HttpService'}${pascal(id)}`;
    const url = outputs[`${prefix}Url`];
    if (url !== undefined && !endpoints.some((e) => e.value === url)) {
      endpoints.push({
        kind: 'url',
        label: prefix.startsWith('StaticSite')
          ? 'website'
          : prefix.startsWith('ContainerService')
            ? 'app'
            : 'api',
        value: url,
        public: true,
      });
    }
  }
  return endpoints;
}

export function linksFor(region: string, deploymentId: string): OperationLink[] {
  const base = `https://${region}.console.aws.amazon.com`;
  return [
    {
      kind: 'console',
      label: 'cloudformation',
      value: `${base}/cloudformation/home?region=${region}#/stacks?filteringText=${deploymentId}`,
    },
    {
      kind: 'logs',
      label: 'logs',
      value: `${base}/cloudwatch/home?region=${region}#logsV2:log-groups$3FlogGroupNameFilter$3D${deploymentId}`,
    },
    {
      kind: 'cost',
      label: 'cost',
      value: 'https://console.aws.amazon.com/costmanagement/home#/cost-explorer',
    },
  ];
}

/** Where each secret the plan asked for lives, never its value. */
export function sensitiveLocations(
  deploymentId: string,
  inputs: readonly { readonly name: string; readonly kind: 'secret' | 'config' }[],
): SensitiveOutput[] {
  return inputs
    .filter((input) => input.kind === 'secret')
    .map((input) => ({
      name: input.name,
      location: `ssm:${parameterPath(deploymentId)}${input.name}`,
    }));
}

export function outputsOf(parts: {
  readonly endpoints: Endpoint[];
  readonly resources: DeployedResource[];
  readonly sensitive: SensitiveOutput[];
  readonly links: OperationLink[];
  readonly kept?: DeployedResource[];
}): ProviderOutputs {
  return {
    endpoints: parts.endpoints,
    resources: parts.resources,
    sensitiveOutputs: parts.sensitive,
    links: parts.links,
    ...(parts.kept === undefined ? {} : { kept: parts.kept }),
  };
}
