import {
  CfnParameter,
  CfnResource,
  Duration,
  PermissionsBoundary,
  RemovalPolicy,
  Stack,
  Tags,
  Validations,
} from 'aws-cdk-lib';
import type { StackProps } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';
import type { Component } from '@hero-cloud/core';
import { toAwsCron } from '../cron.js';
import {
  BOUNDARY_POLICY_NAME,
  WEB_ADAPTER_ACCOUNT,
  WEB_ADAPTER_LAYER_VERSION,
  parameterPath,
  pascal,
} from './names.js';

export interface HeroStackProps extends StackProps {
  readonly deploymentId: string;
  readonly components: readonly Component[];
}

const S = (component: Component, key: string): string => String(component.settings[key] ?? '');

/**
 * One CloudFormation stack per deployment. Every component gets its own scope, and every resource
 * created inside it is marked with the component it belongs to, so a plan can explain each resource
 * (including the helper resources CDK adds) and a person can find exactly what Hero made.
 *
 * Safe defaults are applied here rather than left to chance: buckets are private, encrypted, and
 * require TLS; the CDN accepts only HTTPS; tables have point-in-time recovery and deletion
 * protection; every role carries Hero's permissions boundary and only the permissions its function
 * needs; logs expire.
 */
export class HeroStack extends Stack {
  /** Schedules that could not be expressed exactly, so no schedule was created for them. */
  readonly invalidSchedules: string[] = [];

  readonly #tables = new Map<string, dynamodb.Table>();
  readonly #buckets = new Map<string, s3.Bucket>();
  #artifactBucket: s3.IBucket | undefined;
  readonly #deploymentId: string;

  constructor(scope: Construct, id: string, props: HeroStackProps) {
    super(scope, id, {
      ...props,
      // Every role in this stack must carry Hero's boundary, which caps what any of them can do.
      permissionsBoundary: PermissionsBoundary.fromName(BOUNDARY_POLICY_NAME),
    });
    this.#deploymentId = props.deploymentId;

    Tags.of(this).add('hero:deployment-id', props.deploymentId);

    // Data first, so functions can be granted exactly the data they use.
    const order: Record<Component['kind'], number> = {
      'object-bucket': 0,
      'key-value-table': 0,
      identity: 1,
      'static-site': 2,
      'http-service': 3,
      'scheduled-job': 3,
      'budget-alert': 4,
    };
    const sorted = [...props.components].sort(
      (a, b) => order[a.kind] - order[b.kind] || (a.id < b.id ? -1 : 1),
    );
    for (const component of sorted) {
      const group = new Construct(this, `${pascal(component.kind)}${pascal(component.id)}`);
      this.#add(group, component);
      this.#mark(group, component);
    }
  }

  #add(group: Construct, component: Component): void {
    switch (component.kind) {
      case 'static-site':
        this.#staticSite(group, component);
        break;
      case 'http-service':
        this.#httpService(group, component);
        break;
      case 'scheduled-job':
        this.#scheduledJob(group, component);
        break;
      case 'key-value-table':
        this.#table(group, component);
        break;
      case 'object-bucket':
        this.#bucket(group, component);
        break;
      case 'identity':
        this.#identity(group, component);
        break;
      case 'budget-alert':
        this.#budget(group, component);
        break;
    }
  }

  /** Marks every resource in a component's scope with that component, for plans and removal. */
  #mark(group: Construct, component: Component): void {
    for (const child of group.node.findAll()) {
      if (child instanceof CfnResource) {
        child.addMetadata('hero:component', `${component.kind}.${component.id}`);
        child.addMetadata('hero:capability', component.capability);
        child.addMetadata('hero:rationale', component.rationale);
      }
    }
  }

  /** The logical id CloudFormation will use for a construct's main resource. */
  #logicalId(construct: Construct): string {
    return this.resolve((construct.node.defaultChild as CfnResource).logicalId) as string;
  }

  #privateBucket(scope: Construct, id: string, extra: Partial<s3.BucketProps> = {}): s3.Bucket {
    return new s3.Bucket(scope, id, {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
      ...extra,
    });
  }

  #staticSite(group: Construct, component: Component): void {
    const accessLogs = new s3.Bucket(group, 'AccessLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // CloudFront delivers its logs with ACLs, so this log-only bucket must accept them.
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(accessLogs).acknowledge({
      id: 'AwsSolutions::AwsSolutions-S1',
      reason: 'This is the bucket that receives access logs; logging it would be circular.',
    });

    const files = this.#privateBucket(group, 'Files', {
      serverAccessLogsBucket: accessLogs,
      serverAccessLogsPrefix: 'files/',
    });
    this.#buckets.set(component.id, files);

    const spaFallback = S(component, 'framework') !== 'static';
    const distribution = new cloudfront.Distribution(group, 'Cdn', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(files),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableLogging: true,
      logBucket: accessLogs,
      logFilePrefix: 'cdn/',
      errorResponses: spaFallback
        ? [403, 404].map((httpStatus) => ({
            httpStatus,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: Duration.seconds(10),
          }))
        : [],
    });
    Validations.of(distribution).acknowledge({
      id: 'AwsSolutions::AwsSolutions-CFR1',
      reason: "Geo restrictions are the owner's decision and are not assumed.",
    });
    Validations.of(distribution).acknowledge({
      id: 'AwsSolutions::AwsSolutions-CFR2',
      reason:
        'A web application firewall adds a monthly fee; it is offered separately, not imposed.',
    });
    Validations.of(distribution).acknowledge({
      id: 'AwsSolutions::AwsSolutions-CFR4',
      reason:
        'The default CloudFront certificate fixes the minimum TLS version; a custom domain enables TLS 1.2.',
    });

    this.exportValue(distribution.distributionDomainName, {
      name: `${this.#deploymentId}-site-domain`,
    });
  }

  #artifacts(): s3.IBucket {
    if (this.#artifactBucket === undefined) {
      const name = new CfnParameter(this, 'ArtifactBucket', {
        type: 'String',
        description: 'The bucket that holds the built code.',
        allowedPattern: '^[a-z0-9][a-z0-9.-]{2,62}$',
      });
      this.#artifactBucket = s3.Bucket.fromBucketName(this, 'Artifacts', name.valueAsString);
    }
    return this.#artifactBucket;
  }

  #role(group: Construct, component: Component, logGroup: logs.LogGroup): iam.Role {
    const role = new iam.Role(group, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    logGroup.grantWrite(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParametersByPath', 'ssm:GetParameters'],
        resources: [
          this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: `${parameterPath(this.#deploymentId).slice(1)}*`,
          }),
        ],
      }),
    );
    // Exactly the operations an application uses on its own data, on this deployment's data only.
    for (const table of this.#tables.values()) {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:BatchGetItem',
            'dynamodb:BatchWriteItem',
          ],
          resources: [table.tableArn],
        }),
      );
    }
    for (const bucket of this.#buckets.values()) {
      if (bucket.node.id === 'Files') continue;
      role.addToPolicy(
        new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [bucket.bucketArn] }),
      );
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
          resources: [bucket.arnForObjects('*')],
        }),
      );
    }
    // The only wildcards are the deployment's own parameter path and the objects inside its own
    // buckets. Each is acknowledged by its exact finding, so any other wildcard still fails.
    const parameterArn = `arn:<AWS::Partition>:ssm:${this.region}:${this.account}:parameter${parameterPath(this.#deploymentId)}*`;
    Validations.of(role).acknowledge({
      id: `AwsSolutions::AwsSolutions-IAM5[Resource::${parameterArn}]`,
      reason:
        "The role may read the settings and secrets stored under this deployment's own parameter path.",
    });
    for (const bucket of this.#buckets.values()) {
      if (bucket.node.id === 'Files') continue;
      Validations.of(role).acknowledge({
        id: `AwsSolutions::AwsSolutions-IAM5[Resource::<${this.#logicalId(bucket)}.Arn>/*]`,
        reason: "The role may read and write the objects of this deployment's own data bucket.",
      });
    }
    return role;
  }

  #environment(): Record<string, string> {
    const env: Record<string, string> = {
      HERO_DEPLOYMENT: this.#deploymentId,
      HERO_PARAMETER_PATH: parameterPath(this.#deploymentId),
    };
    for (const [id, table] of this.#tables)
      env[`HERO_TABLE_${pascal(id).toUpperCase()}`] = table.tableName;
    for (const [id, bucket] of this.#buckets) {
      if (bucket.node.id !== 'Files')
        env[`HERO_BUCKET_${pascal(id).toUpperCase()}`] = bucket.bucketName;
    }
    return env;
  }

  #codeKey(component: Component): CfnParameter {
    return new CfnParameter(this, `Code${pascal(component.id)}Key`, {
      type: 'String',
      description: `The key of the built code for ${component.id} in the artifact bucket.`,
      allowedPattern: '^[A-Za-z0-9._/-]{1,512}$',
    });
  }

  #httpService(group: Construct, component: Component): void {
    const port = Number(component.settings.port ?? 8080);
    const logGroup = new logs.LogGroup(group, 'Logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = this.#role(group, component, logGroup);
    const key = this.#codeKey(component);
    const fn = new lambda.Function(group, 'Function', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(29),
      handler: 'run.sh',
      code: lambda.Code.fromBucketV2(this.#artifacts(), key.valueAsString),
      role,
      logGroup,
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(
          group,
          'WebAdapter',
          `arn:aws:lambda:${this.region}:${WEB_ADAPTER_ACCOUNT}:layer:LambdaAdapterLayerArm64:${String(WEB_ADAPTER_LAYER_VERSION)}`,
        ),
      ],
      environment: {
        ...this.#environment(),
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_PORT: String(port),
        AWS_LWA_READINESS_CHECK_PATH: S(component, 'healthPath') || '/',
      },
    });

    const api = new apigwv2.HttpApi(group, 'Api', {
      defaultIntegration: new integrations.HttpLambdaIntegration('Integration', fn),
    });
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (stage !== undefined) {
      const accessLogs = new logs.LogGroup(group, 'AccessLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      stage.accessLogSettings = {
        destinationArn: accessLogs.logGroupArn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          ip: '$context.identity.sourceIp',
          requestTime: '$context.requestTime',
          method: '$context.httpMethod',
          path: '$context.path',
          status: '$context.status',
          responseLength: '$context.responseLength',
        }),
      };
      stage.defaultRouteSettings = { throttlingBurstLimit: 100, throttlingRateLimit: 50 };
    }
    for (const route of api.node.findAll()) {
      if (route instanceof apigwv2.CfnRoute) {
        Validations.of(route).acknowledge({
          id: 'AwsSolutions::AwsSolutions-APIG4',
          reason:
            'The application decides who may call it; Hero does not add an authorizer in front.',
        });
      }
    }
    this.exportValue(api.apiEndpoint, { name: `${this.#deploymentId}-${component.id}-endpoint` });
  }

  #scheduledJob(group: Construct, component: Component): void {
    const logGroup = new logs.LogGroup(group, 'Logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const role = this.#role(group, component, logGroup);
    const key = this.#codeKey(component);
    const fn = new lambda.Function(group, 'Function', {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.minutes(15),
      handler: 'job.handler',
      code: lambda.Code.fromBucketV2(this.#artifacts(), key.valueAsString),
      role,
      logGroup,
      environment: this.#environment(),
    });

    const expression = toAwsCron(S(component, 'schedule'));
    if (expression === undefined) {
      this.invalidSchedules.push(component.id);
      return;
    }
    const invokeRole = new iam.Role(group, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    fn.grantInvoke(invokeRole);
    Validations.of(invokeRole).acknowledge({
      id: `AwsSolutions::AwsSolutions-IAM5[Resource::<${this.#logicalId(fn)}.Arn>:*]`,
      reason:
        'The scheduler may invoke any version or alias of this one function, and nothing else.',
    });
    new scheduler.CfnSchedule(group, 'Schedule', {
      scheduleExpression: expression,
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      state: 'ENABLED',
      target: {
        arn: fn.functionArn,
        roleArn: invokeRole.roleArn,
        retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 3600 },
      },
    });
  }

  #table(group: Construct, component: Component): void {
    const type = (value: string): dynamodb.AttributeType =>
      value === 'number'
        ? dynamodb.AttributeType.NUMBER
        : value === 'binary'
          ? dynamodb.AttributeType.BINARY
          : dynamodb.AttributeType.STRING;
    const partition = S(component, 'partitionKey');
    if (partition === '') throw new Error(`table ${component.id} has no key`);
    const sort = S(component, 'sortKey');
    const table = new dynamodb.Table(group, 'Table', {
      partitionKey: { name: partition, type: type(S(component, 'partitionKeyType')) },
      ...(sort === '' ? {} : { sortKey: { name: sort, type: type(S(component, 'sortKeyType')) } }),
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    this.#tables.set(component.id, table);
  }

  #bucket(group: Construct, component: Component): void {
    const logs = this.#privateBucket(group, 'AccessLogs', {
      versioned: false,
      lifecycleRules: [{ expiration: Duration.days(90) }],
    });
    Validations.of(logs).acknowledge({
      id: 'AwsSolutions::AwsSolutions-S1',
      reason: 'This is the bucket that receives access logs; logging it would be circular.',
    });
    const bucket = this.#privateBucket(group, 'Data', {
      serverAccessLogsBucket: logs,
      serverAccessLogsPrefix: 'data/',
    });
    this.#buckets.set(component.id, bucket);
  }

  #identity(group: Construct, component: Component): void {
    const pool = new cognito.UserPool(group, 'Pool', {
      selfSignUpEnabled: S(component, 'selfSignUp') === 'true',
      signInAliases: { email: true },
      autoVerify: { email: true },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    });
    Validations.of(pool).acknowledge({
      id: 'AwsSolutions::AwsSolutions-COG2',
      reason:
        "Multi-factor sign-in is offered as optional; requiring it is the application owner's decision.",
    });
    Validations.of(pool).acknowledge({
      id: 'AwsSolutions::AwsSolutions-COG8',
      reason: 'The Plus feature plan adds a per-user fee and is not enabled by default.',
    });
    Validations.of(pool).acknowledge({
      id: 'AwsSolutions::AwsSolutions-COG3',
      reason: 'Advanced security features add a per-user fee and are not enabled by default.',
    });
    pool.addClient('Client', {
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: { flows: { authorizationCodeGrant: true } },
      preventUserExistenceErrors: true,
    });
  }

  #budget(group: Construct, component: Component): void {
    const email = new CfnParameter(this, 'BudgetEmail', {
      type: 'String',
      description: 'The email address that receives spending alerts.',
      allowedPattern: '^[^@\\s]{1,64}@[^@\\s]{1,255}$',
    });
    new budgets.CfnBudget(group, 'Budget', {
      budget: {
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: Number(component.settings.monthlyLimitUsd ?? 10), unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: Number(component.settings.alertAtPercent ?? 80),
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: email.valueAsString }],
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: email.valueAsString }],
        },
      ],
    });
  }
}
