/**
 * The kinds of AWS resource this provider can plan. Each has a message at every audience level
 * under `resource.<type>`, and a test fails the build if one is missing.
 */
export const awsResourceTypes = [
  's3-bucket',
  's3-bucket-policy',
  'cloudfront-distribution',
  'cloudfront-access-control',
  'apigatewayv2-api',
  'apigatewayv2-stage',
  'apigatewayv2-integration',
  'apigatewayv2-route',
  'lambda-function',
  'lambda-permission',
  'iam-role',
  'iam-policy',
  'logs-log-group',
  'scheduler-schedule',
  'dynamodb-table',
  'cognito-user-pool',
  'cognito-user-pool-client',
  'budgets-budget',
  'ssm-parameter',
  'cloudformation-stack',
  'codebuild-project',
  'codebuild-build',
  'vpc',
  'ecs-cluster',
  'ecs-service',
  'ecs-task-definition',
  'load-balancer',
  'load-balancer-target-group',
  'rds-instance',
  'efs-file-system',
  'ecr-repository',
  'secrets-manager-secret',
  'other-resource',
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
  'build.in-your-account',
  'cost.assumption.traffic',
  'cost.assumption.function',
  'cost.assumption.free-tier',
  'cost.assumption.no-domain',
  'cost.assumption.region-prices',
  'cost.assumption.container-prices',
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
  'load-balancer',
  'container-compute',
  'public-addresses',
  'managed-database',
  'managed-database-storage',
  'shared-files',
  'container-registry',
  'secrets',
] as const;
