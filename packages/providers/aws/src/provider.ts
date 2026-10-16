import { rmSync } from 'node:fs';
import type {
  CloudProvider,
  PlanWarning,
  ProviderPlanRequest,
  ProviderPlanResult,
} from '@hero-cloud/core';
import { canonicalJson, sha256Hex } from '@hero-cloud/shared';
import { parameterPath } from './cdk/names.js';
import { buildJobChanges } from './build/changes.js';
import { buildPlanFor } from './build/plan.js';
import { bundleHash, storeBundle } from './bundle.js';
import { synthesize, synthesizeBuild } from './cdk/synth.js';
import { changesFromTemplate } from './changes.js';
import { estimateCost } from './cost.js';
import { getIdentity } from './identity.js';
import { parameterChanges } from './parameters.js';
import { builtInPriceBook } from './prices/book.js';
import { loadPriceBook } from './prices/live.js';
import type { FetchText } from './prices/live.js';

export interface AwsProviderOptions {
  /** Folder where downloaded prices are cached. Without one, prices are fetched each time. */
  readonly cacheDirectory?: string;
  /**
   * Folder where each approved cloud assembly is kept, named by its hash. Deploying later uses the
   * stored assembly, never a fresh synthesis, so what runs is exactly what was approved.
   */
  readonly assemblyDirectory?: string;
  readonly fetchText?: FetchText;
  /** A named profile from the shared AWS configuration, used to find out who the user is. */
  readonly profile?: string;
  readonly now?: () => Date;
}

const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d$/;
const MEMO_LIMIT = 32;

/**
 * The AWS provider. It plans: it builds the real infrastructure template for the components,
 * validates it against the AWS Solutions rules (a violation stops the plan), lists every resource
 * that will exist, estimates cost from public prices, and returns the hash of the cloud assembly
 * it would apply. It makes no call that needs credentials.
 */
export function createAwsProvider(options: AwsProviderOptions = {}): CloudProvider {
  // Synthesis is pure but not free, so equal requests reuse their result.
  const memo = new Map<string, ProviderPlanResult>();

  return {
    id: 'aws',
    identity: (identityOptions = {}) =>
      getIdentity({
        ...(identityOptions.region === undefined ? {} : { region: identityOptions.region }),
        ...(options.profile === undefined ? {} : { profile: options.profile }),
      }),
    async describe(request: ProviderPlanRequest): Promise<ProviderPlanResult> {
      const region = REGION.test(request.region) ? request.region : 'us-east-1';
      const key = sha256Hex(canonicalJson({ ...request, region, network: request.allowNetwork }));
      const known = memo.get(key);
      if (known !== undefined) return known;

      const assembly = synthesize({
        deploymentId: request.deploymentId,
        region,
        accountId: request.accountId,
        components: request.components,
      });
      const buildPlan = buildPlanFor(request.components);
      const buildAssembly =
        buildPlan.jobs.length === 0
          ? undefined
          : synthesizeBuild({
              deploymentId: request.deploymentId,
              region,
              accountId: request.accountId,
            });
      const artifactHash = bundleHash({
        appHash: assembly.hash,
        buildHash: buildAssembly?.hash,
        buildPlan,
      });
      if (options.assemblyDirectory !== undefined) {
        storeBundle(options.assemblyDirectory, {
          appHash: assembly.hash,
          buildHash: buildAssembly?.hash,
          buildPlan,
          appDirectory: assembly.directory,
          buildDirectory: buildAssembly?.directory,
        });
      }
      rmSync(assembly.directory, { recursive: true, force: true });
      if (buildAssembly !== undefined) {
        rmSync(buildAssembly.directory, { recursive: true, force: true });
      }

      const changes = [
        ...changesFromTemplate(assembly.template, region, request.deploymentId),
        ...(buildAssembly === undefined
          ? []
          : [
              ...changesFromTemplate(buildAssembly.template, region, request.deploymentId),
              ...buildJobChanges(buildPlan, region, request.deploymentId),
            ]),
        ...parameterChanges(
          request.inputs,
          region,
          request.deploymentId,
          parameterPath(request.deploymentId),
        ),
      ];

      const prices = await loadPriceBook(
        {
          region,
          allowNetwork: request.allowNetwork,
          ...(options.cacheDirectory === undefined
            ? {}
            : { cacheDirectory: options.cacheDirectory }),
          ...(options.fetchText === undefined ? {} : { fetchText: options.fetchText }),
          ...(options.now === undefined ? {} : { now: options.now }),
        },
        builtInPriceBook(region),
      );
      const cost = estimateCost({ components: request.components, prices });

      const warnings: PlanWarning[] = [];
      if (cost.confidence === 'low') {
        warnings.push({
          code: 'plan.cost-low-confidence',
          severity: 'info',
          params: { reason: request.allowNetwork ? 'prices-unavailable' : 'offline', region },
        });
      }
      for (const id of assembly.invalidSchedules) {
        warnings.push({
          code: 'plan.unsupported-schedule',
          severity: 'blocking',
          params: { job: id },
        });
      }

      const result: ProviderPlanResult = {
        changes,
        warnings,
        cost,
        // The hash of everything that will be applied: the stacks, the account, the region, and
        // the exact build commands.
        artifactHash,
      };
      if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
      memo.set(key, result);
      return result;
    },
  };
}
