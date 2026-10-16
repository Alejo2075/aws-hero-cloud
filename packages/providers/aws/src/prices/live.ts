import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BUILT_IN_PRICES, isSanePrice, priceKeys } from './book.js';
import type { PriceBook, PriceKey } from './book.js';

/**
 * The AWS Price List bulk files are public: no account or credentials are needed to read them.
 * Hero fetches only the few small files it needs, from this host, over HTTPS.
 */
const HOST = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/';
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Offer {
  readonly products?: Readonly<Record<string, { attributes?: Readonly<Record<string, string>> }>>;
  readonly terms?: {
    readonly OnDemand?: Readonly<
      Record<
        string,
        Readonly<
          Record<
            string,
            {
              priceDimensions: Readonly<
                Record<
                  string,
                  {
                    beginRange: string;
                    endRange: string;
                    unit: string;
                    pricePerUnit: Readonly<Record<string, string>>;
                  }
                >
              >;
            }
          >
        >
      >
    >;
  };
  readonly publicationDate?: string;
}

/** First-tier On-Demand USD price of the product whose `usagetype` matches. */
function firstTierPrice(offer: Offer, usageType: RegExp): number | undefined {
  for (const [sku, product] of Object.entries(offer.products ?? {})) {
    if (!usageType.test(product.attributes?.usagetype ?? '')) continue;
    const dimensions = Object.values(offer.terms?.OnDemand?.[sku] ?? {}).flatMap((term) =>
      Object.values(term.priceDimensions),
    );
    const first = dimensions
      .filter((dimension) => dimension.pricePerUnit.USD !== undefined)
      .sort((a, b) => Number(a.beginRange) - Number(b.beginRange))
      .find((dimension) => Number(dimension.pricePerUnit.USD) > 0);
    if (first !== undefined) return Number(first.pricePerUnit.USD);
  }
  return undefined;
}

interface Source {
  readonly file: string;
  readonly key: PriceKey;
  readonly usageType: RegExp;
}

/**
 * A usage type is `[REGION-]Name`, where REGION is letters and a digit such as `USE1`. Variants of
 * the same name (`IA-WriteRequestUnits`, `ReplWriteRequestUnits`, `Tables-Requests-Tier1`) are
 * different products with different prices, so the match must be exact.
 */
const REGION_PREFIX = String.raw`(?:[A-Z]{2,4}\d-)?`;
const exact = (name: string): RegExp => new RegExp(`^${REGION_PREFIX}${name}$`);

/** Where each price lives in the bulk files. Prices that cannot be found keep their built-in value. */
export const PRICE_SOURCES: readonly Source[] = [
  {
    file: 'AmazonApiGateway/current/{region}/index.json',
    key: 'apigw.http-request',
    usageType: exact('ApiGatewayHttpRequest'),
  },
  {
    file: 'AWSLambda/current/{region}/index.json',
    key: 'lambda.request',
    usageType: exact('Request'),
  },
  {
    file: 'AWSLambda/current/{region}/index.json',
    key: 'lambda.gb-second.arm',
    usageType: exact('Lambda-GB-Second-ARM'),
  },
  {
    file: 'AmazonDynamoDB/current/{region}/index.json',
    key: 'dynamodb.read-unit',
    usageType: exact('ReadRequestUnits'),
  },
  {
    file: 'AmazonDynamoDB/current/{region}/index.json',
    key: 'dynamodb.write-unit',
    usageType: exact('WriteRequestUnits'),
  },
  {
    file: 'AmazonDynamoDB/current/{region}/index.json',
    key: 'dynamodb.storage-gb',
    usageType: exact('TimedStorage-ByteHrs'),
  },
  {
    file: 'AmazonDynamoDB/current/{region}/index.json',
    key: 'dynamodb.pitr-gb',
    usageType: exact('TimedPITRStorage-ByteHrs'),
  },
  {
    file: 'AmazonS3/current/{region}/index.json',
    key: 's3.storage-gb',
    usageType: exact('TimedStorage-ByteHrs'),
  },
  {
    file: 'AmazonS3/current/{region}/index.json',
    key: 's3.put-request',
    usageType: exact('Requests-Tier1'),
  },
  {
    file: 'AmazonS3/current/{region}/index.json',
    key: 's3.get-request',
    usageType: exact('Requests-Tier2'),
  },
  {
    file: 'AmazonCloudWatch/current/{region}/index.json',
    key: 'logs.ingest-gb',
    usageType: exact('DataProcessing-Bytes'),
  },
  {
    file: 'AmazonCognito/current/{region}/index.json',
    key: 'cognito.mau',
    usageType: exact('CognitoUserPoolsMAU'),
  },
];

export type FetchText = (url: string, options: { readonly signal: AbortSignal }) => Promise<string>;

const defaultFetch: FetchText = async (url, { signal }) => {
  const response = await fetch(url, { signal, redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) throw new Error('too large');
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('too large');
  return text;
};

interface CachedBook {
  readonly fetchedAt: string;
  readonly asOf: string;
  readonly region: string;
  readonly prices: Readonly<Record<PriceKey, number>>;
}

export interface PriceLoaderOptions {
  readonly region: string;
  /** Folder for the cache. Without one, nothing is stored. */
  readonly cacheDirectory?: string;
  readonly fetchText?: FetchText;
  readonly now?: () => Date;
  readonly ttlMs?: number;
}

function cachePath(directory: string, region: string): string {
  return join(directory, `prices-${region.replace(/[^a-z0-9-]/g, '')}.json`);
}

function isCached(value: unknown, region: string): value is CachedBook {
  if (typeof value !== 'object' || value === null) return false;
  const book = value as Partial<CachedBook>;
  return (
    book.region === region &&
    typeof book.fetchedAt === 'string' &&
    typeof book.asOf === 'string' &&
    typeof book.prices === 'object' &&
    priceKeys.every((key) => isSanePrice((book.prices as Record<string, unknown> | null)?.[key]))
  );
}

async function readCache(
  options: PriceLoaderOptions,
  now: Date,
  ttl: number,
): Promise<PriceBook | undefined> {
  if (options.cacheDirectory === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      await readFile(cachePath(options.cacheDirectory, options.region), 'utf8'),
    );
    if (!isCached(parsed, options.region)) return undefined;
    if (now.getTime() - Date.parse(parsed.fetchedAt) > ttl) return undefined;
    return { source: 'cache', asOf: parsed.asOf, region: options.region, prices: parsed.prices };
  } catch {
    return undefined;
  }
}

async function writeCache(options: PriceLoaderOptions, book: PriceBook, now: Date): Promise<void> {
  if (options.cacheDirectory === undefined) return;
  const path = cachePath(options.cacheDirectory, options.region);
  const cached: CachedBook = {
    fetchedAt: now.toISOString(),
    asOf: book.asOf,
    region: book.region,
    prices: book.prices,
  };
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${String(process.pid)}.tmp`;
    await writeFile(temporary, JSON.stringify(cached), { mode: 0o600 });
    await rename(temporary, path);
  } catch {
    // A cache that cannot be written is not an error: prices were still obtained.
  }
}

/**
 * Gets current prices: a fresh cache if there is one, otherwise the public AWS Price List, and
 * otherwise `undefined` so the caller falls back to the built-in table. It never throws, never
 * sends credentials, and accepts only prices that are finite and of a believable size.
 */
export async function loadLivePrices(options: PriceLoaderOptions): Promise<PriceBook | undefined> {
  const now = (options.now ?? (() => new Date()))();
  const cached = await readCache(options, now, options.ttlMs ?? DEFAULT_TTL_MS);
  if (cached !== undefined) return cached;
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(options.region)) return undefined;

  const fetchText = options.fetchText ?? defaultFetch;
  const prices: Record<PriceKey, number> = { ...BUILT_IN_PRICES };
  let asOf = '';
  try {
    const files = new Map<string, Offer>();
    for (const file of new Set(PRICE_SOURCES.map((source) => source.file))) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, TIMEOUT_MS);
      try {
        const text = await fetchText(`${HOST}${file.replace('{region}', options.region)}`, {
          signal: controller.signal,
        });
        files.set(file, JSON.parse(text) as Offer);
      } finally {
        clearTimeout(timer);
      }
    }
    for (const source of PRICE_SOURCES) {
      const offer = files.get(source.file);
      const price = offer === undefined ? undefined : firstTierPrice(offer, source.usageType);
      if (price !== undefined) {
        if (!isSanePrice(price)) return undefined;
        prices[source.key] = price;
      }
      const published = offer?.publicationDate?.slice(0, 10);
      if (published !== undefined && published > asOf) asOf = published;
    }
  } catch {
    return undefined;
  }
  if (asOf === '') return undefined;
  const book: PriceBook = { source: 'live', asOf, region: options.region, prices };
  await writeCache(options, book, now);
  return book;
}

/** Live prices when they can be had, otherwise the built-in table. */
export async function loadPriceBook(
  options: PriceLoaderOptions & { readonly allowNetwork: boolean },
  fallback: PriceBook,
): Promise<PriceBook> {
  if (!options.allowNetwork) return fallback;
  return (await loadLivePrices(options)) ?? fallback;
}
