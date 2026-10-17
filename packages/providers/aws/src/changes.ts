import type { PlanChange, Rationale } from '@hero-cloud/core';
import type { CfnResourceEntry, CfnTemplate } from './cdk/synth.js';
import type { AwsResourceType } from './resources.js';

/** The friendly kind of each CloudFormation resource Hero can create. Anything else is `other-resource`. */
const TYPE_OF: Readonly<Record<string, AwsResourceType>> = {
  'AWS::S3::Bucket': 's3-bucket',
  'AWS::S3::BucketPolicy': 's3-bucket-policy',
  'AWS::CloudFront::Distribution': 'cloudfront-distribution',
  'AWS::CloudFront::OriginAccessControl': 'cloudfront-access-control',
  'AWS::ApiGatewayV2::Api': 'apigatewayv2-api',
  'AWS::ApiGatewayV2::Stage': 'apigatewayv2-stage',
  'AWS::ApiGatewayV2::Integration': 'apigatewayv2-integration',
  'AWS::ApiGatewayV2::Route': 'apigatewayv2-route',
  'AWS::Lambda::Function': 'lambda-function',
  'AWS::Lambda::Permission': 'lambda-permission',
  'AWS::IAM::Role': 'iam-role',
  'AWS::IAM::Policy': 'iam-policy',
  'AWS::Logs::LogGroup': 'logs-log-group',
  'AWS::Scheduler::Schedule': 'scheduler-schedule',
  'AWS::DynamoDB::Table': 'dynamodb-table',
  'AWS::Cognito::UserPool': 'cognito-user-pool',
  'AWS::Cognito::UserPoolClient': 'cognito-user-pool-client',
  'AWS::Budgets::Budget': 'budgets-budget',
  'AWS::CodeBuild::Project': 'codebuild-project',
  'AWS::EC2::VPC': 'vpc',
  'AWS::ECS::Cluster': 'ecs-cluster',
  'AWS::ECS::Service': 'ecs-service',
  'AWS::ECS::TaskDefinition': 'ecs-task-definition',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'load-balancer',
  'AWS::ElasticLoadBalancingV2::TargetGroup': 'load-balancer-target-group',
  'AWS::RDS::DBInstance': 'rds-instance',
  'AWS::EFS::FileSystem': 'efs-file-system',
  'AWS::ECR::Repository': 'ecr-repository',
  'AWS::SecretsManager::Secret': 'secrets-manager-secret',
};

/** The safeguards each kind of resource carries, as reasons a person can read. */
const GUARDRAILS: Readonly<Partial<Record<AwsResourceType, readonly string[]>>> = {
  's3-bucket': ['guardrail.private-by-default', 'guardrail.encryption'],
  's3-bucket-policy': ['guardrail.https-only'],
  'cloudfront-distribution': ['guardrail.https-only'],
  'apigatewayv2-api': ['guardrail.https-only'],
  'iam-role': ['guardrail.least-privilege'],
  'iam-policy': ['guardrail.least-privilege'],
  'logs-log-group': ['guardrail.log-retention'],
  'dynamodb-table': ['guardrail.backups', 'guardrail.encryption'],
  'rds-instance': ['guardrail.backups', 'guardrail.encryption', 'guardrail.private-by-default'],
  'efs-file-system': ['guardrail.backups', 'guardrail.encryption', 'guardrail.private-by-default'],
  'ecr-repository': ['guardrail.encryption'],
  'load-balancer': ['guardrail.log-retention'],
};

type Record_ = Readonly<Record<string, unknown>>;
const asRecord = (value: unknown): Record_ =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record_) : {};
const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

function statements(
  properties: Record_,
): { effect: string; actions: string[]; resources: number }[] {
  return asArray(asRecord(properties.PolicyDocument).Statement).map((raw) => {
    const statement = asRecord(raw);
    const actions = [statement.Action].flat().filter((a): a is string => typeof a === 'string');
    return {
      effect: text(statement.Effect) ?? 'Allow',
      actions: actions.sort(),
      resources: [statement.Resource].flat().length,
    };
  });
}

/** The settings of a resource a reader may want to see. Never values that could hold secrets. */
function summarize(
  type: AwsResourceType | undefined,
  entry: CfnResourceEntry,
): Record<string, unknown> {
  const p = asRecord(entry.Properties);
  switch (type) {
    case 'lambda-function':
      return {
        runtime: p.Runtime,
        architecture: asArray(p.Architectures)[0],
        memoryMb: p.MemorySize,
        timeoutSeconds: p.Timeout,
        handler: p.Handler,
        environmentNames: Object.keys(asRecord(asRecord(p.Environment).Variables)).sort(),
      };
    case 'iam-role':
      return {
        trustedServices: asArray(asRecord(p.AssumeRolePolicyDocument).Statement).flatMap((raw) =>
          [asRecord(asRecord(raw).Principal).Service]
            .flat()
            .filter((s): s is string => typeof s === 'string'),
        ),
        permissionsBoundary: p.PermissionsBoundary !== undefined,
      };
    case 'iam-policy':
      return { statements: statements(p) };
    case 's3-bucket':
      return {
        blockPublicAccess: asRecord(p.PublicAccessBlockConfiguration),
        encryption: 'SSE-S3',
        versioning: asRecord(p.VersioningConfiguration).Status === 'Enabled',
        accessLogging: p.LoggingConfiguration !== undefined,
      };
    case 'cloudfront-distribution': {
      const config = asRecord(p.DistributionConfig);
      return {
        viewerProtocol: asRecord(config.DefaultCacheBehavior).ViewerProtocolPolicy,
        httpVersion: config.HttpVersion,
        defaultRootObject: config.DefaultRootObject,
        accessLogging: config.Logging !== undefined,
      };
    }
    case 'dynamodb-table':
      return {
        keySchema: asArray(p.KeySchema).map(
          (raw) =>
            `${text(asRecord(raw).AttributeName) ?? '?'}:${text(asRecord(raw).KeyType) ?? '?'}`,
        ),
        billing: p.BillingMode,
        pointInTimeRecovery: asRecord(p.PointInTimeRecoverySpecification)
          .PointInTimeRecoveryEnabled,
        deletionProtection: p.DeletionProtectionEnabled,
      };
    case 'rds-instance':
      return {
        engine: p.Engine,
        instanceClass: p.DBInstanceClass,
        storageGb: p.AllocatedStorage,
        storageEncrypted: p.StorageEncrypted,
        backupDays: p.BackupRetentionPeriod,
        multiAz: p.MultiAZ,
        publiclyAccessible: p.PubliclyAccessible,
        deletionProtection: p.DeletionProtection,
      };
    case 'ecs-service':
      return { desiredCount: p.DesiredCount, launchType: p.LaunchType, publicAddress: true };
    case 'ecs-task-definition':
      return {
        cpu: p.Cpu,
        memory: p.Memory,
        architecture: asRecord(p.RuntimePlatform).CpuArchitecture,
      };
    case 'load-balancer':
      return { scheme: p.Scheme, type: p.Type };
    case 'efs-file-system':
      return { encrypted: p.Encrypted };
    case 'apigatewayv2-api':
      return { protocol: p.ProtocolType };
    case 'apigatewayv2-stage':
      return {
        accessLogging: p.AccessLogSettings !== undefined,
        throttling: p.DefaultRouteSettings,
      };
    case 'logs-log-group':
      return { retentionDays: p.RetentionInDays };
    case 'scheduler-schedule':
      return {
        expression: p.ScheduleExpression,
        timezone: p.ScheduleExpressionTimezone,
        state: p.State,
      };
    case 'cognito-user-pool':
      return { mfa: p.MfaConfiguration, deletionProtection: p.DeletionProtection };
    case 'budgets-budget': {
      const budget = asRecord(p.Budget);
      return { limit: asRecord(budget.BudgetLimit), timeUnit: budget.TimeUnit };
    }
    default:
      return {};
  }
}

/** The last parts of the construct path, such as `Cdn` or `Role/DefaultPolicy`, as a readable name. */
function nameOf(entry: CfnResourceEntry, logicalId: string): string {
  const path = text(entry.Metadata?.['aws:cdk:path']);
  if (path === undefined) return logicalId;
  const parts = path
    .split('/')
    .slice(2)
    .filter((part) => part !== 'Resource');
  return parts.length === 0 ? logicalId : parts.join('/').replace(/[{}]/g, '');
}

function metadataRationale(entry: CfnResourceEntry): Rationale[] {
  const raw = entry.Metadata?.['hero:rationale'];
  return asArray(raw).map((item): Rationale => {
    const r = asRecord(item);
    return {
      code: text(r.code) ?? 'unknown',
      ...(r.params === undefined ? {} : { params: r.params as Rationale['params'] }),
      ...(Array.isArray(r.evidence)
        ? { evidence: r.evidence.filter((e): e is string => typeof e === 'string') }
        : {}),
    };
  });
}

/**
 * Turns the synthesized template into the list of changes a person reviews. Because it reads the
 * real template, the plan lists every resource that will exist, including helpers such as bucket
 * policies and role policies, and each is tied to the component that needs it.
 */
export function changesFromTemplate(
  template: CfnTemplate,
  region: string,
  deploymentId: string,
): PlanChange[] {
  const changes: PlanChange[] = [];
  for (const [logicalId, entry] of Object.entries(template.Resources)) {
    const type = TYPE_OF[entry.Type];
    const component = text(entry.Metadata?.['hero:component']) ?? 'stack';
    const guardrails = (type === undefined ? [] : (GUARDRAILS[type] ?? [])).map(
      (code): Rationale => ({ code }),
    );
    const versioned =
      type === 's3-bucket' && asRecord(entry.Properties).VersioningConfiguration !== undefined;
    const rationale = [
      ...metadataRationale(entry),
      ...guardrails,
      ...(versioned ? [{ code: 'guardrail.versioning' }] : []),
    ];
    const kind = type ?? 'other-resource';
    const onDestroy =
      entry.DeletionPolicy === 'Retain' || entry.DeletionPolicy === 'Snapshot' ? 'keep' : 'delete';
    changes.push({
      id: `${component}:${kind}:${logicalId}`,
      action: 'create',
      capability: text(entry.Metadata?.['hero:capability']) ?? 'cost-control',
      resource: { provider: 'aws', type: kind, name: nameOf(entry, logicalId) },
      destructive: false,
      rationale,
      // A value a resource does not set is left out, because a plan holds only values it can seal.
      details: JSON.parse(
        JSON.stringify({
          cloudFormationType: entry.Type,
          logicalId,
          ...summarize(type, entry),
          onDestroy,
          region,
          tags: { 'hero:deployment-id': deploymentId },
        }),
      ) as Record<string, unknown>,
    });
  }
  return changes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
