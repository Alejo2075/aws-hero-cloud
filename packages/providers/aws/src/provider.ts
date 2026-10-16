import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { heroError } from '@hero-cloud/core';
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
import { bundleHash, loadBundle, storeBundle } from './bundle.js';
import { synthesize, synthesizeBuild } from './cdk/synth.js';
import { changesFromTemplate } from './changes.js';
import type { CfnTemplate } from './cdk/synth.js';
import { estimateCost } from './cost.js';
import { createApplier } from './deploy/apply.js';
import { defaultToolkit } from './deploy/deployer.js';
import { diffAgainstDeployed } from './deploy/diff.js';
import { createHealthChecker } from './deploy/health.js';
import { describeBootstrap } from './bootstrap/bootstrapper.js';
import { createBootstrapper } from './bootstrap/bootstrapper.js';
import { getIdentity } from './identity.js';
import { inspectSetup } from './onboarding.js';
import { parameterChanges } from './parameters.js';
import { builtInPriceBook } from './prices/book.js';
import { loadPriceBook } from './prices/live.js';
import type { FetchText } from './prices/live.js';
import type { ToolkitFactory } from './deploy/deployer.js';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';

export interface AwsProviderOptions {
  /** Folder where downloaded prices are cached. Without one, prices are fetched each time. */
  readonly cacheDirectory?: string;
  /**
   * Folder where each approved cloud assembly is kept, named by its hash. Deploying later uses the
   * stored assembly, never a fresh synthesis, so what runs is exactly what was approved.
   */
  readonly assemblyDirectory?: string;
  readonly fetchText?: FetchText;
  /** The toolkit used to deploy; tests pass a fake. */
  readonly toolkit?: ToolkitFactory;
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
  const applierFor = (region: string) =>
    createApplier({
      assemblyDirectory: options.assemblyDirectory ?? '',
      region,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      ...(options.toolkit === undefined ? {} : { toolkit: options.toolkit }),
    });

  const needsBundles = (): never => {
    throw heroError('provider.unavailable', { reason: 'no-assembly-directory' });
  };

  return {
    id: 'aws',
    apply: (request) =>
      options.assemblyDirectory === undefined
        ? needsBundles()
        : applierFor(request.plan.target.region).apply(request),
    destroy: (request) =>
      options.assemblyDirectory === undefined
        ? needsBundles()
        : applierFor(request.plan.target.region).destroy(request),
    diff: async (request) => {
      if (options.assemblyDirectory === undefined) return needsBundles();
      const bundle = loadBundle(options.assemblyDirectory, request.artifactHash, {
        accountId: request.accountId,
        region: request.region,
      });
      const template = JSON.parse(
        readFileSync(join(bundle.appDirectory, `${request.deploymentId}.template.json`), 'utf8'),
      ) as CfnTemplate;
      const changed = await diffAgainstDeployed(
        {
          assemblyDirectory: bundle.appDirectory,
          artifactHash: bundle.appHash,
          accountId: request.accountId,
          region: request.region,
          deploymentId: request.deploymentId,
          template,
        },
        options.toolkit ?? defaultToolkit(request.region, options.profile),
      );
      // Everything that is not part of the application template (the build stack, the builds, the
      // settings) is applied again as it is, and shown as an update.
      const inTemplate = new Set(
        changesFromTemplate(template, request.region, request.deploymentId).map((c) => c.id),
      );
      const rest = request.fresh
        .filter((change) => !inTemplate.has(change.id))
        .map((change) => ({ ...change, action: 'update' as const }));
      return [...changed, ...rest];
    },
    health: (request) =>
      createHealthChecker({
        cloudFormation: new CloudFormationClient({
          region: request.region,
          ...(options.profile === undefined ? {} : { profile: options.profile }),
        }),
      })(request),
    inspect: (inspectOptions) =>
      inspectSetup({
        region: inspectOptions.region,
        ...(inspectOptions.profile === undefined ? {} : { profile: inspectOptions.profile }),
        cloudFormationFor: (profile, region) =>
          new CloudFormationClient({
            region,
            ...(profile === undefined ? {} : { profile }),
          }),
      }),
    describeBootstrap: (target) => describeBootstrap(target),
    bootstrap: async (request) => {
      const outcome = await createBootstrapper({
        region: request.plan.target.region,
        ...(options.profile === undefined ? {} : { profile: options.profile }),
      }).run({
        accountId: request.plan.target.accountId,
        region: request.plan.target.region,
        artifactHash: request.plan.artifactHash,
        approved: true,
      });
      return { deployerRoleArn: outcome.deployerRoleArn };
    },
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
