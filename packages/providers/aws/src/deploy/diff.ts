import type { ChangeAction, PlanChange } from '@hero-cloud/core';
import { changesFromTemplate } from '../changes.js';
import type { CfnTemplate } from '../cdk/synth.js';
import { verifyAssembly } from './assembly.js';
import type { ToolkitFactory } from './deployer.js';
import { createGuardedIoHost } from './guard.js';

/** What the diff reads of a resource's difference. The real objects have much more. */
export interface ResourceDifferenceLike {
  readonly changeImpact?: string;
  readonly isAddition: boolean;
  readonly isRemoval: boolean;
  readonly newResourceType?: string;
  readonly oldResourceType?: string;
}

export interface StackDiffLike {
  readonly resources: {
    readonly changes: Readonly<Record<string, ResourceDifferenceLike>>;
  };
}

/**
 * Turns what CloudFormation says it will do into plan actions. A resource that will be replaced
 * or destroyed is destructive, and one that *may* be replaced is treated as replaced: a plan
 * must never understate what could be lost.
 */
export function actionOf(difference: ResourceDifferenceLike): {
  action: ChangeAction;
  destructive: boolean;
} | null {
  if (difference.isAddition) return { action: 'create', destructive: false };
  if (difference.isRemoval || difference.changeImpact === 'WILL_DESTROY') {
    return { action: 'delete', destructive: true };
  }
  switch (difference.changeImpact) {
    case 'WILL_REPLACE':
    case 'MAY_REPLACE':
      return { action: 'replace', destructive: true };
    case 'WILL_UPDATE':
      return { action: 'update', destructive: false };
    case 'WILL_CREATE':
      return { action: 'create', destructive: false };
    case 'NO_CHANGE':
      return null;
    default:
      // Anything unknown is shown as a destructive update rather than hidden.
      return { action: 'update', destructive: true };
  }
}

/**
 * Re-labels the changes of a freshly synthesized template with what CloudFormation will really do
 * to the deployed stack. Resources that are not in the template any more are listed as deletions
 * and resources that will not change are omitted.
 */
export function applyDiff(
  fresh: readonly PlanChange[],
  diff: StackDiffLike,
  region: string,
  deploymentId: string,
): PlanChange[] {
  const byLogicalId = new Map(
    fresh.map((change) => {
      const id = change.details?.logicalId;
      return [typeof id === 'string' ? id : '', change] as const;
    }),
  );
  const result: PlanChange[] = [];
  for (const [logicalId, difference] of Object.entries(diff.resources.changes)) {
    const decided = actionOf(difference);
    if (decided === null) continue;
    const known = byLogicalId.get(logicalId);
    if (known !== undefined) {
      result.push({ ...known, ...decided });
    } else {
      const type = difference.oldResourceType ?? difference.newResourceType ?? 'unknown';
      result.push({
        id: `stack:${logicalId}`,
        capability: 'cost-control',
        resource: { provider: 'aws', type: 'other-resource', name: logicalId },
        rationale: [],
        details: {
          cloudFormationType: type,
          logicalId,
          region,
          tags: { 'hero:deployment-id': deploymentId },
        },
        ...decided,
      });
    }
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface DiffRequest {
  readonly assemblyDirectory: string;
  readonly artifactHash: string;
  readonly accountId: string;
  readonly region: string;
  readonly deploymentId: string;
  readonly template: CfnTemplate;
  readonly parameters?: Readonly<Record<string, string>>;
}

/**
 * Asks CloudFormation, through a change set, what applying the stored assembly would do to the
 * stack that exists now. The change set is only created and read, never executed. Needs
 * credentials, and so is used when updating a deployment, never when planning a new one.
 */
export async function diffAgainstDeployed(
  request: DiffRequest,
  toolkitFactory: ToolkitFactory,
): Promise<PlanChange[]> {
  const verified = verifyAssembly(request.assemblyDirectory, {
    hash: request.artifactHash,
    accountId: request.accountId,
    region: request.region,
  });
  const toolkit = await toolkitFactory(createGuardedIoHost({ approved: false }));
  const source = await toolkit.fromAssemblyDirectory(verified.directory);
  const diffs = await toolkit.diff(source, { parameters: request.parameters ?? {} });
  const diff = diffs[verified.stackName];
  const fresh = changesFromTemplate(request.template, request.region, request.deploymentId);
  return applyDiff(
    fresh,
    diff ?? { resources: { changes: {} } },
    request.region,
    request.deploymentId,
  );
}
