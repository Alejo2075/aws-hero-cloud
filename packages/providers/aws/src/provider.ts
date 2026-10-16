import type {
  CloudProvider,
  PlanChange,
  PlanWarning,
  ProviderPlanRequest,
  ProviderPlanResult,
} from '@hero-cloud/core';
import { canonicalJson, sha256Hex } from '@hero-cloud/shared';
import { estimateCost } from './cost.js';
import { parametersFor, resourcesFor, toChange } from './mapping.js';
import { builtInPriceBook } from './prices/book.js';
import { loadPriceBook } from './prices/live.js';
import type { FetchText } from './prices/live.js';

export interface AwsProviderOptions {
  /** Folder where downloaded prices are cached. Without one, prices are fetched each time. */
  readonly cacheDirectory?: string;
  readonly fetchText?: FetchText;
  readonly now?: () => Date;
}

const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d$/;

/**
 * The AWS provider. Today it plans: it maps provider-neutral components to AWS resources, adds the
 * safeguards Hero always applies, and estimates cost from public prices. It makes no call that
 * needs credentials. Deploying arrives in a later phase.
 */
export function createAwsProvider(options: AwsProviderOptions = {}): CloudProvider {
  return {
    id: 'aws',
    async describe(request: ProviderPlanRequest): Promise<ProviderPlanResult> {
      const region = REGION.test(request.region) ? request.region : 'us-east-1';
      const tables = request.components
        .filter((c) => c.kind === 'key-value-table')
        .map((c) => c.id);

      const changes: PlanChange[] = [];
      for (const component of request.components) {
        for (const planned of resourcesFor(component, tables)) {
          changes.push(
            toChange(planned, `${component.kind}.${component.id}`, region, request.deploymentId),
          );
        }
      }
      for (const planned of parametersFor(request.inputs)) {
        changes.push(toChange(planned, 'input', region, request.deploymentId));
      }

      const fallback = builtInPriceBook(region);
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
        fallback,
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

      // What will be applied, as data. Once synthesis exists this becomes the cloud assembly hash.
      const artifactHash = sha256Hex(
        canonicalJson({
          provider: 'aws',
          region,
          account: request.accountId,
          deployment: request.deploymentId,
          changes,
        }),
      );
      return { changes, warnings, cost, artifactHash };
    },
  };
}
