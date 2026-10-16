/**
 * The kinds of AWS resource this provider can plan. Each has a message at every audience level
 * under `resource.<type>`, and a test fails the build if one is missing.
 */
export const awsResourceTypes = [
  's3-bucket',
  'cloudfront-distribution',
  'apigatewayv2-api',
  'lambda-function',
  'iam-role',
  'logs-log-group',
  'scheduler-schedule',
  'dynamodb-table',
  'cognito-user-pool',
  'cognito-user-pool-client',
  'budgets-budget',
  'ssm-parameter',
] as const;

export type AwsResourceType = (typeof awsResourceTypes)[number];

/** Rationale codes added by this provider, under `rationale.<code>`. */
export const awsRationaleCodes = [
  'guardrail.private-by-default',
  'guardrail.encryption',
  'guardrail.https-only',
  'guardrail.least-privilege',
  'guardrail.log-retention',
  'guardrail.backups',
  'guardrail.versioning',
  'guardrail.secret-store',
  'cost.assumption.traffic',
  'cost.assumption.function',
  'cost.assumption.free-tier',
  'cost.assumption.no-domain',
  'cost.assumption.region-prices',
] as const;

/** Cost line codes, under `cost.line.<code>`. */
export const awsCostLineCodes = [
  'static-storage',
  'static-origin-requests',
  'cdn-delivery',
  'api-requests',
  'function-compute',
  'database-operations',
  'database-storage',
  'file-storage',
  'sign-in',
  'logs',
] as const;
