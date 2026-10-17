import type { Stack } from 'aws-cdk-lib';
import { CfnParameter, Duration, RemovalPolicy, Validations } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import type { Component } from '@hero-cloud/core';
import { parameterPath, pascal } from './names.js';

const S = (component: Component, key: string): string => String(component.settings[key] ?? '');
const N = (component: Component, key: string, fallback: number): number =>
  Number(component.settings[key] ?? fallback);

/** The header that proves a request came through the CDN and not straight to the load balancer. */
export const ORIGIN_HEADER = 'x-hero-origin-verify';

export interface DataAccess {
  readonly tables: ReadonlyMap<string, { readonly tableArn: string }>;
  readonly buckets: ReadonlyMap<string, { readonly bucketArn: string }>;
}

interface Platform {
  readonly vpc: ec2.Vpc;
  readonly cluster: ecs.Cluster;
  readonly serviceGroup: ec2.SecurityGroup;
  readonly listener: elbv2.ApplicationListener;
  readonly originValue: string;
  readonly distribution: cloudfront.Distribution;
}

interface Database {
  readonly instance: rds.DatabaseInstance;
  readonly name: string;
}

export type Output = (component: Component, thing: string, value: string) => void;

/**
 * Everything a container deployment needs beyond the application itself: a private network, a load
 * balancer behind a CDN (so visitors always use HTTPS and nothing reaches the load balancer
 * directly), managed databases and shared file systems that only the application can reach, and
 * the service that runs the image. Shared pieces are created on first use.
 */
export class ContainerParts {
  readonly #stack: Stack;
  readonly #deploymentId: string;
  readonly #output: Output;
  #platform: Platform | undefined;
  #repository: ecr.IRepository | undefined;
  readonly #databases = new Map<string, Database>();
  readonly #files = new Map<
    string,
    { fs: efs.FileSystem; access: efs.AccessPoint; mount: string }
  >();

  constructor(stack: Stack, deploymentId: string, output: Output) {
    this.#stack = stack;
    this.#deploymentId = deploymentId;
    this.#output = output;
  }

  /** The image repository the build stack created, named by a parameter filled in at deploy time. */
  #images(): ecr.IRepository {
    if (this.#repository === undefined) {
      const name = new CfnParameter(this.#stack, 'ImageRepository', {
        type: 'String',
        description: 'The repository that holds the application image.',
        allowedPattern: '^[a-z0-9][a-z0-9._/-]{1,255}$',
      });
      this.#repository = ecr.Repository.fromRepositoryName(
        this.#stack,
        'Images',
        name.valueAsString,
      );
    }
    return this.#repository;
  }

  /** Creates the network, the cluster, the load balancer, and the CDN once. */
  createPlatform(scope: Construct, component: Component): Platform {
    if (this.#platform !== undefined) return this.#platform;

    const flowLogs = new logs.LogGroup(scope, 'FlowLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const vpc = new ec2.Vpc(scope, 'Network', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      // No NAT gateway: it would cost more than the application. Tasks get a public address but
      // accept traffic only from the load balancer.
      natGateways: 0,
      restrictDefaultSecurityGroup: false,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      flowLogs: {
        all: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogs),
          trafficType: ec2.FlowLogTrafficType.ALL,
        },
      },
    });

    const logBucket = new s3.Bucket(scope, 'AccessLogs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // CloudFront delivers its logs with ACLs, so this log-only bucket must accept them.
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(logBucket).acknowledge({
      id: 'AwsSolutions::AwsSolutions-S1',
      reason: 'This is the bucket that receives access logs; logging it would be circular.',
    });

    const origin = new secrets.Secret(scope, 'OriginSecret', {
      // Named for the deployment, so permissions can be limited to this deployment's secrets.
      secretName: `${this.#deploymentId}/origin`,
      description: 'Shared between the CDN and the load balancer so only the CDN is served.',
      generateSecretString: { excludePunctuation: true, passwordLength: 40 },
    });
    Validations.of(origin).acknowledge({
      id: 'AwsSolutions::AwsSolutions-SMG4',
      reason:
        'The value only proves a request came through the CDN of this deployment; replacing it means redeploying.',
    });
    const originValue = origin.secretValue.unsafeUnwrap();

    const albGroup = new ec2.SecurityGroup(scope, 'LoadBalancerGroup', {
      vpc,
      description: 'The load balancer of this deployment',
      allowAllOutbound: true,
    });
    albGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Requests from the CDN');
    Validations.of(albGroup).acknowledge({
      id: 'AwsSolutions::AwsSolutions-EC23',
      reason:
        'The CDN has no fixed addresses. Requests without its secret header get a 403 from the load balancer.',
    });
    const alb = new elbv2.ApplicationLoadBalancer(scope, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: albGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      dropInvalidHeaderFields: true,
    });
    alb.logAccessLogs(logBucket, 'load-balancer');
    const listener = alb.addListener('Http', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Forbidden',
      }),
    });
    Validations.of(listener).acknowledge({
      id: 'AwsSolutions::AwsSolutions-ELB2',
      reason: 'Access logs of the load balancer are written to the access log bucket.',
    });

    const distribution = new cloudfront.Distribution(scope, 'Cdn', {
      comment: `Hero Cloud: ${this.#deploymentId}`,
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(alb, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          customHeaders: { [ORIGIN_HEADER]: originValue },
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        compress: true,
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket,
      logFilePrefix: 'cdn/',
    });
    Validations.of(distribution).acknowledge({
      id: 'AwsSolutions::AwsSolutions-CFR1',
      reason:
        'Which countries may visit is the owner’s decision; restricting them by default would block real visitors.',
    });
    Validations.of(distribution).acknowledge({
      id: 'AwsSolutions::AwsSolutions-CFR2',
      reason:
        'A web application firewall adds a monthly charge and rules that depend on the application; it can be added later.',
    });
    Validations.of(distribution).acknowledge({
      id: 'AwsSolutions::AwsSolutions-CFR5',
      reason:
        'Without a custom domain there is no certificate for the load balancer, so the CDN reaches it over HTTP inside AWS. The load balancer serves only requests that carry a secret header that is unique to this deployment, and the plan says so.',
    });
    Validations.of(distribution).acknowledge({
      id: 'AwsSolutions::AwsSolutions-CFR4',
      reason:
        'The default CloudFront certificate fixes the minimum TLS version; a custom domain enables TLS 1.2.',
    });

    const cluster = new ecs.Cluster(scope, 'Cluster', { vpc });
    Validations.of(cluster).acknowledge({
      id: 'AwsSolutions::AwsSolutions-ECS4',
      reason:
        'Container Insights adds a metrics charge; service logs and load balancer metrics are on.',
    });
    const serviceGroup = new ec2.SecurityGroup(scope, 'ServiceGroup', {
      vpc,
      description: 'The application containers of this deployment',
      allowAllOutbound: true,
    });

    this.#output(component, 'Url', `https://${distribution.distributionDomainName}`);
    this.#output(component, 'DistributionId', distribution.distributionId);
    this.#platform = { vpc, cluster, serviceGroup, listener, originValue, distribution };
    return this.#platform;
  }

  /** A managed database in the private part of the network, reachable only from the application. */
  database(group: Construct, component: Component, platform: Platform): void {
    const engine = S(component, 'engine') === 'mysql' ? 'mysql' : 'postgres';
    const port = engine === 'mysql' ? 3306 : 5432;
    const subnets = new rds.SubnetGroup(group, 'Subnets', {
      description: 'The private subnets of the database',
      vpc: platform.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });
    const databaseGroup = new ec2.SecurityGroup(group, 'Group', {
      vpc: platform.vpc,
      description: 'Only the application may reach the database',
      allowAllOutbound: false,
    });
    databaseGroup.addIngressRule(platform.serviceGroup, ec2.Port.tcp(port), 'The application');

    const parameters =
      engine === 'mysql'
        ? new rds.ParameterGroup(group, 'Parameters', {
            engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
            parameters: { require_secure_transport: 'ON' },
          })
        : new rds.ParameterGroup(group, 'Parameters', {
            engine: rds.DatabaseInstanceEngine.postgres({
              version: rds.PostgresEngineVersion.VER_16,
            }),
            parameters: { 'rds.force_ssl': '1' },
          });

    const instance = new rds.DatabaseInstance(group, 'Instance', {
      engine:
        engine === 'mysql'
          ? rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 })
          : rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MICRO,
      ),
      vpc: platform.vpc,
      subnetGroup: subnets,
      securityGroups: [databaseGroup],
      parameterGroup: parameters,
      allocatedStorage: N(component, 'storageGb', 20),
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      credentials: rds.Credentials.fromGeneratedSecret('hero_admin', {
        secretName: `${this.#deploymentId}/database/${component.id}`,
      }),
      databaseName: 'app',
      multiAz: false,
      publiclyAccessible: false,
      iamAuthentication: true,
      autoMinorVersionUpgrade: true,
      backupRetention: Duration.days(N(component, 'backupDays', 7)),
      // Removing the deployment keeps a final snapshot of the data instead of the running database.
      deletionProtection: false,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });
    const why = (id: string, reason: string): void => {
      Validations.of(instance).acknowledge({ id: `AwsSolutions::AwsSolutions-${id}`, reason });
    };
    why(
      'RDS3',
      'One database instance keeps the monthly cost low; backups and a final snapshot protect the data.',
    );
    why(
      'RDS10',
      'A final snapshot is kept when the deployment is removed; protection would block a planned removal.',
    );
    why(
      'RDS11',
      'The database accepts connections only from the application, so the default port is not exposed.',
    );
    why(
      'SMG4',
      'The database login is generated once for this deployment and read only by its application.',
    );
    this.#databases.set(component.id, { instance, name: pascal(component.id) });
  }

  /** A shared, encrypted, backed-up file system that survives restarts of the application. */
  fileSystem(group: Construct, component: Component, platform: Platform): void {
    const fsGroup = new ec2.SecurityGroup(group, 'Group', {
      vpc: platform.vpc,
      description: 'Only the application may mount the file system',
      allowAllOutbound: false,
    });
    fsGroup.addIngressRule(platform.serviceGroup, ec2.Port.tcp(2049), 'The application');
    const fs = new efs.FileSystem(group, 'Files', {
      vpc: platform.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroup: fsGroup,
      encrypted: true,
      enableAutomaticBackups: true,
      allowAnonymousAccess: false,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const access = fs.addAccessPoint('App', {
      path: '/app',
      createAcl: { ownerUid: '1000', ownerGid: '1000', permissions: '755' },
      posixUser: { uid: '1000', gid: '1000' },
    });
    this.#files.set(component.id, { fs, access, mount: S(component, 'mountPath') || '/data' });
  }

  /** The service that runs the image behind the load balancer. */
  service(group: Construct, component: Component, platform: Platform, data: DataAccess): void {
    const port = N(component, 'port', 8080);
    const logGroup = new logs.LogGroup(group, 'Logs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const task = new ecs.FargateTaskDefinition(group, 'Task', {
      cpu: N(component, 'cpu', 256),
      memoryLimitMiB: N(component, 'memoryMb', 512),
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const tag = new CfnParameter(this.#stack, `Image${pascal(component.id)}Tag`, {
      type: 'String',
      description: `The tag of the built image of ${component.id}.`,
      allowedPattern: '^[A-Za-z0-9._-]{1,128}$',
    });

    const environment: Record<string, string> = {
      PORT: String(port),
      HERO_DEPLOYMENT: this.#deploymentId,
      HERO_PARAMETER_PATH: parameterPath(this.#deploymentId),
    };
    const secretsForTask: Record<string, ecs.Secret> = {};
    for (const [id, database] of this.#databases) {
      const key = pascal(id).toUpperCase();
      const prefix = this.#databases.size === 1 ? 'DB' : `DB_${key}`;
      environment[`${prefix}_HOST`] = database.instance.dbInstanceEndpointAddress;
      environment[`${prefix}_PORT`] = database.instance.dbInstanceEndpointPort;
      environment[`${prefix}_NAME`] = 'app';
      environment[`${prefix}_USER`] = 'hero_admin';
      environment[`${prefix}_SSLMODE`] = 'require';
      if (database.instance.secret !== undefined) {
        secretsForTask[`${prefix}_PASSWORD`] = ecs.Secret.fromSecretsManager(
          database.instance.secret,
          'password',
        );
      }
      database.instance.connections.allowDefaultPortFrom(platform.serviceGroup);
    }

    const container = task.addContainer('App', {
      image: ecs.ContainerImage.fromEcrRepository(this.#images(), tag.valueAsString),
      portMappings: [{ containerPort: port }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'app', logGroup }),
      environment,
      secrets: secretsForTask,
    });
    for (const [id, file] of this.#files) {
      const name = `files-${id}`;
      task.addVolume({
        name,
        efsVolumeConfiguration: {
          fileSystemId: file.fs.fileSystemId,
          transitEncryption: 'ENABLED',
          authorizationConfig: { accessPointId: file.access.accessPointId, iam: 'ENABLED' },
        },
      });
      container.addMountPoints({ containerPath: file.mount, sourceVolume: name, readOnly: false });
      container.addEnvironment('HERO_DATA_DIR', file.mount);
      file.fs.grantRootAccess(task.taskRole);
    }

    // The application may read its own settings, and use only the data of this deployment.
    const role = task.taskRole;
    const parameterArn = this.#stack.formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: `${parameterPath(this.#deploymentId).slice(1)}*`,
    });
    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParametersByPath', 'ssm:GetParameters'],
        resources: [parameterArn],
      }),
    );
    for (const [id, table] of data.tables) {
      container.addEnvironment(
        `HERO_TABLE_${pascal(id).toUpperCase()}`,
        table.tableArn.split('/').pop() ?? '',
      );
      role.addToPrincipalPolicy(
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
    for (const bucket of data.buckets.values()) {
      role.addToPrincipalPolicy(
        new iam.PolicyStatement({ actions: ['s3:ListBucket'], resources: [bucket.bucketArn] }),
      );
      role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
          resources: [`${bucket.bucketArn}/*`],
        }),
      );
    }

    const service = new ecs.FargateService(group, 'Service', {
      cluster: platform.cluster,
      taskDefinition: task,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [platform.serviceGroup],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(90),
    });
    const target = new elbv2.ApplicationTargetGroup(group, 'Target', {
      vpc: platform.vpc,
      port,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [service],
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        path: S(component, 'healthPath') || '/',
        healthyHttpCodes: '200-399',
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: Duration.seconds(30),
      },
    });
    platform.listener.addAction(`Route${pascal(component.id)}`, {
      priority: 1,
      conditions: [elbv2.ListenerCondition.httpHeader(ORIGIN_HEADER, [platform.originValue])],
      action: elbv2.ListenerAction.forward([target]),
    });

    const parameterWildcard = `arn:<AWS::Partition>:ssm:${this.#stack.region}:${this.#stack.account}:parameter${parameterPath(this.#deploymentId)}*`;
    this.acknowledge(
      task.taskRole,
      'IAM5',
      `Resource::${parameterWildcard}`,
      "The application may read the settings and secrets stored under this deployment's own parameter path.",
    );
    this.acknowledge(
      task.executionRole ?? task.taskRole,
      'IAM5',
      'Resource::*',
      'Pulling an image first needs a login token, which AWS lets no single resource scope.',
    );
    Validations.of(task).acknowledge({
      id: 'AwsSolutions::AwsSolutions-ECS2',
      reason:
        'The values set directly are plain settings (port, names, addresses). Passwords come from Secrets Manager and Parameter Store.',
    });

    this.#output(component, 'TargetGroup', target.targetGroupArn);
    this.#output(component, 'Cluster', platform.cluster.clusterName);
    this.#output(component, 'ServiceName', service.serviceName);
  }

  hasDatabase(): boolean {
    return this.#databases.size > 0;
  }

  readonly acknowledge = (target: Construct, id: string, finding: string, reason: string): void => {
    Validations.of(target).acknowledge({
      id: `AwsSolutions::AwsSolutions-${id}[${finding}]`,
      reason,
    });
  };
}
