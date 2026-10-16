/**
 * Unit prices Hero needs to estimate a serverless deployment. All amounts are in US dollars.
 *
 * The built-in table below holds the public On-Demand prices for `us-east-1` published by AWS on
 * 2026-10-13 (the AWS Price List bulk files). It is the fallback when Hero is offline or the live
 * lookup fails, and the estimate then says its prices are built in.
 */
export const priceKeys = [
  'apigw.http-request',
  'lambda.request',
  'lambda.gb-second.arm',
  'dynamodb.read-unit',
  'dynamodb.write-unit',
  'dynamodb.storage-gb',
  'dynamodb.pitr-gb',
  's3.storage-gb',
  's3.put-request',
  's3.get-request',
  'cloudfront.transfer-gb',
  'cloudfront.https-request',
  'logs.ingest-gb',
  'logs.storage-gb',
  'cognito.mau',
] as const;

export type PriceKey = (typeof priceKeys)[number];

export interface PriceBook {
  readonly source: 'live' | 'cache' | 'built-in';
  /** Publication date of the prices, `YYYY-MM-DD`. */
  readonly asOf: string;
  readonly region: string;
  readonly prices: Readonly<Record<PriceKey, number>>;
}

export const BUILT_IN_PRICES: Readonly<Record<PriceKey, number>> = {
  'apigw.http-request': 0.000001,
  'lambda.request': 0.0000002,
  'lambda.gb-second.arm': 0.0000133334,
  'dynamodb.read-unit': 0.000000125,
  'dynamodb.write-unit': 0.000000625,
  'dynamodb.storage-gb': 0.25,
  'dynamodb.pitr-gb': 0.2,
  's3.storage-gb': 0.023,
  's3.put-request': 0.000005,
  's3.get-request': 0.0000004,
  'cloudfront.transfer-gb': 0.085,
  'cloudfront.https-request': 0.000001,
  'logs.ingest-gb': 0.5,
  'logs.storage-gb': 0.03,
  'cognito.mau': 0.0055,
};

export const BUILT_IN_AS_OF = '2026-10-13';

/** The always-free allowances that apply to the services Hero uses (AWS Free Tier terms). */
export const FREE_ALLOWANCE = {
  lambdaRequests: 1_000_000,
  lambdaGbSeconds: 400_000,
  dynamodbStorageGb: 25,
  logsIngestGb: 5,
  cognitoMau: 10_000,
  cloudfrontTransferGb: 1_000,
  cloudfrontRequests: 10_000_000,
} as const;

/** The prices that are not region-specific are published for `us-east-1` only; others are scaled by region. */
export function builtInPriceBook(region: string): PriceBook {
  return { source: 'built-in', asOf: BUILT_IN_AS_OF, region, prices: BUILT_IN_PRICES };
}

/** A price is accepted only if it is a finite, non-negative number of a believable size. */
export function isSanePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}
