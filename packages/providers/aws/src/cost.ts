import type { Component, CostEstimate, CostLine, Rationale } from '@hero-cloud/core';
import { cronRunsPerMonth } from './cron.js';
import { FREE_ALLOWANCE } from './prices/book.js';
import type { PriceBook } from './prices/book.js';

/**
 * Usage assumptions behind every estimate. `low` is an application that is nearly idle and `high`
 * a busy small one. They are stated, not hidden, because the real number depends on traffic that
 * nobody can know before deploying.
 */
const USAGE = {
  low: {
    requests: 1_000,
    pageviews: 1_000,
    siteGb: 0.1,
    transferGb: 0.01,
    logGb: 0.01,
    mau: 0,
    seconds: 5,
  },
  high: {
    requests: 1_000_000,
    pageviews: 100_000,
    siteGb: 1,
    transferGb: 20,
    logGb: 1,
    mau: 1_000,
    seconds: 30,
  },
} as const;

const LAMBDA_MEMORY_GB = 0.5;
const REQUEST_SECONDS = { low: 0.1, high: 0.25 } as const;
const DDB = { readsPerRequest: 2, writesPerRequest: 0.5, storageGb: 1 } as const;
const PAGEVIEW_TO_ORIGIN = 0.1;

type Level = 'low' | 'high';

const over = (used: number, free: number): number => Math.max(0, used - free);

interface Money {
  low: number;
  high: number;
}

const zero = (): Money => ({ low: 0, high: 0 });

function each(compute: (level: Level) => number): Money {
  return { low: compute('low'), high: compute('high') };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CostInputs {
  readonly components: readonly Component[];
  readonly prices: PriceBook;
}

/** Estimates the monthly cost of a set of components from a price book. Pure and deterministic. */
export function estimateCost({ components, prices }: CostInputs): CostEstimate {
  const p = prices.prices;
  const lines = new Map<string, Money>();
  const add = (code: string, money: Money): void => {
    const current = lines.get(code) ?? zero();
    lines.set(code, { low: current.low + money.low, high: current.high + money.high });
  };

  let functionRequests: Money = zero();
  let functionGbSeconds: Money = zero();
  let logGb: Money = zero();
  let mau: Money = zero();

  for (const component of components) {
    switch (component.kind) {
      case 'static-site': {
        add(
          'static-storage',
          each((level) => USAGE[level].siteGb * p['s3.storage-gb']),
        );
        add(
          'static-origin-requests',
          each((level) => USAGE[level].pageviews * PAGEVIEW_TO_ORIGIN * p['s3.get-request']),
        );
        add(
          'cdn-delivery',
          each(
            (level) =>
              over(USAGE[level].transferGb, FREE_ALLOWANCE.cloudfrontTransferGb) *
                p['cloudfront.transfer-gb'] +
              over(USAGE[level].pageviews, FREE_ALLOWANCE.cloudfrontRequests) *
                p['cloudfront.https-request'],
          ),
        );
        break;
      }
      case 'http-service': {
        add(
          'api-requests',
          each((level) => USAGE[level].requests * p['apigw.http-request']),
        );
        functionRequests = {
          low: functionRequests.low + USAGE.low.requests,
          high: functionRequests.high + USAGE.high.requests,
        };
        functionGbSeconds = {
          low: functionGbSeconds.low + USAGE.low.requests * REQUEST_SECONDS.low * LAMBDA_MEMORY_GB,
          high:
            functionGbSeconds.high + USAGE.high.requests * REQUEST_SECONDS.high * LAMBDA_MEMORY_GB,
        };
        logGb = { low: logGb.low + USAGE.low.logGb, high: logGb.high + USAGE.high.logGb };
        break;
      }
      case 'scheduled-job': {
        const runs = cronRunsPerMonth(String(component.settings.schedule ?? '')) ?? 24 * 30;
        functionRequests = { low: functionRequests.low + runs, high: functionRequests.high + runs };
        functionGbSeconds = {
          low: functionGbSeconds.low + runs * USAGE.low.seconds * LAMBDA_MEMORY_GB,
          high: functionGbSeconds.high + runs * USAGE.high.seconds * LAMBDA_MEMORY_GB,
        };
        logGb = { low: logGb.low + USAGE.low.logGb, high: logGb.high + USAGE.high.logGb };
        break;
      }
      case 'key-value-table': {
        add(
          'database-operations',
          each(
            (level) =>
              USAGE[level].requests * DDB.readsPerRequest * p['dynamodb.read-unit'] +
              USAGE[level].requests * DDB.writesPerRequest * p['dynamodb.write-unit'],
          ),
        );
        add(
          'database-storage',
          each(
            () =>
              over(DDB.storageGb, FREE_ALLOWANCE.dynamodbStorageGb) * p['dynamodb.storage-gb'] +
              DDB.storageGb * p['dynamodb.pitr-gb'],
          ),
        );
        break;
      }
      case 'object-bucket': {
        add(
          'file-storage',
          each((level) => USAGE[level].siteGb * p['s3.storage-gb']),
        );
        break;
      }
      case 'identity': {
        mau = { low: mau.low + USAGE.low.mau, high: mau.high + USAGE.high.mau };
        break;
      }
      case 'budget-alert':
        break;
    }
  }

  if (functionRequests.high > 0) {
    add(
      'function-compute',
      each(
        (level) =>
          over(functionRequests[level], FREE_ALLOWANCE.lambdaRequests) * p['lambda.request'] +
          over(functionGbSeconds[level], FREE_ALLOWANCE.lambdaGbSeconds) *
            p['lambda.gb-second.arm'],
      ),
    );
  }
  if (logGb.high > 0) {
    add(
      'logs',
      each(
        (level) =>
          over(logGb[level], FREE_ALLOWANCE.logsIngestGb) * p['logs.ingest-gb'] +
          logGb[level] * p['logs.storage-gb'],
      ),
    );
  }
  if (mau.high > 0) {
    add(
      'sign-in',
      each((level) => over(mau[level], FREE_ALLOWANCE.cognitoMau) * p['cognito.mau']),
    );
  }

  const costLines: CostLine[] = [...lines.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([code, money]) => ({
      code,
      monthlyLow: round(money.low),
      monthlyHigh: round(money.high),
    }));
  const total = [...lines.values()].reduce(
    (sum, money) => ({ low: sum.low + money.low, high: sum.high + money.high }),
    zero(),
  );

  const assumptions: Rationale[] = [
    {
      code: 'cost.assumption.traffic',
      params: { low: USAGE.low.requests, high: USAGE.high.requests },
    },
    {
      code: 'cost.assumption.function',
      params: { memoryMb: LAMBDA_MEMORY_GB * 1024, architecture: 'arm64' },
    },
    { code: 'cost.assumption.free-tier' },
    { code: 'cost.assumption.no-domain' },
    {
      code: 'cost.assumption.region-prices',
      params: { region: prices.region, source: prices.source, asOf: prices.asOf },
    },
  ];

  return {
    currency: 'USD',
    monthlyLow: round(total.low),
    monthlyHigh: round(total.high),
    confidence: prices.source === 'built-in' ? 'low' : 'medium',
    lines: costLines,
    assumptions,
    priceSource: prices.source,
    pricesAsOf: prices.asOf,
  };
}
