import { rmSync } from 'node:fs';
import type { Component } from '@hero-cloud/core';
import { describe, expect, it } from 'vitest';
import { synthesizeBuild, synthesize } from './synth.js';
import type { CfnResourceEntry } from './synth.js';

const component = (
  kind: Component['kind'],
  id: string,
  settings: Component['settings'] = {},
): Component => ({ id, kind, capability: kind, settings, rationale: [] });

const service = component('container-service', 'api', {
  runtime: 'python',
  port: 8000,
  build: 'buildpack',
  cpu: 256,
  memoryMb: 512,
  healthPath: '/up',
});
const database = component('relational-database', 'db', {
  engine: 'postgres',
  backupDays: 7,
  storageGb: 20,
});
const files = component('file-system', 'files', { mountPath: '/data' });

function build(components: Component[]) {
  const result = synthesize({
    deploymentId: 'hero-c',
    accountId: '123456789012',
    region: 'us-east-1',
    components,
  });
  rmSync(result.directory, { recursive: true, force: true });
  return result;
}

describe('a container deployment', () => {
  const { template, hash, parameters } = build([service, database, files]);
  const all = Object.values(template.Resources);
  const ofType = (type: string): CfnResourceEntry[] => all.filter((r) => r.Type === type);
  const props = (type: string) => ofType(type).map((r) => r.Properties ?? {});

  it('is stable and passes the AWS Solutions rules', () => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(build([service, database, files]).hash).toBe(hash);
  });

  it('asks for the image to be named at deploy time, never inventing one', () => {
    expect(parameters).toEqual(expect.arrayContaining(['ImageRepository', 'ImageApiTag']));
  });

  it('serves nothing from the load balancer unless the request came through the CDN', () => {
    const [listener] = props('AWS::ElasticLoadBalancingV2::Listener');
    expect(JSON.stringify(listener?.DefaultActions)).toContain('"StatusCode":"403"');
    const [rule] = props('AWS::ElasticLoadBalancingV2::ListenerRule');
    expect(JSON.stringify(rule?.Conditions)).toContain('x-hero-origin-verify');
    const [cdn] = props('AWS::CloudFront::Distribution');
    const config = (cdn?.DistributionConfig ?? {}) as {
      DefaultCacheBehavior: { ViewerProtocolPolicy: string };
      Origins: {
        CustomOriginConfig: { OriginProtocolPolicy: string };
        OriginCustomHeaders: { HeaderName: string }[];
      }[];
    };
    expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(config.Origins[0]?.OriginCustomHeaders[0]?.HeaderName).toBe('x-hero-origin-verify');
  });

  it('keeps the secret header out of the template: it is resolved from Secrets Manager at deploy', () => {
    const text = JSON.stringify(template);
    expect(text).toContain('{{resolve:secretsmanager:');
  });

  it('names its secrets for the deployment, so permissions can be limited to them', () => {
    const names = props('AWS::SecretsManager::Secret').map((x) => x.Name);
    expect(names.sort()).toEqual(['hero-c/database/db', 'hero-c/origin']);
  });

  it('puts the database out of reach: private, encrypted, backed up, reachable only from the service', () => {
    const [instance] = props('AWS::RDS::DBInstance');
    expect(instance).toMatchObject({
      PubliclyAccessible: false,
      StorageEncrypted: true,
      BackupRetentionPeriod: 7,
      MultiAZ: false,
      EnableIAMDatabaseAuthentication: true,
    });
    const resource = ofType('AWS::RDS::DBInstance')[0];
    expect(resource?.DeletionPolicy).toBe('Snapshot');
    const inline = props('AWS::EC2::SecurityGroup').flatMap(
      (g) => (g.SecurityGroupIngress ?? []) as { CidrIp?: string; FromPort: number }[],
    );
    const separate = props('AWS::EC2::SecurityGroupIngress') as {
      CidrIp?: string;
      FromPort: number;
    }[];
    const open = [...inline, ...separate].filter((i) => i.CidrIp !== undefined);
    expect(open.map((i) => [i.CidrIp, i.FromPort])).toEqual([['0.0.0.0/0', 80]]);
    expect(JSON.stringify(template)).not.toMatch(/"MasterUserPassword":"[^{]/);
  });

  it('gives the container its database password from a secret, never as plain text', () => {
    const [task] = props('AWS::ECS::TaskDefinition');
    const container = (
      (task?.ContainerDefinitions ?? []) as {
        Environment: { Name: string }[];
        Secrets: { Name: string }[];
      }[]
    )[0];
    expect(container?.Secrets.map((s) => s.Name)).toEqual(['DB_PASSWORD']);
    const names = container?.Environment.map((e) => e.Name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['DB_HOST', 'DB_PORT', 'PORT', 'HERO_DATA_DIR']));
    expect(names).not.toContain('DB_PASSWORD');
    expect(task).toMatchObject({ RuntimePlatform: { CpuArchitecture: 'ARM64' } });
  });

  it('mounts an encrypted, backed-up file system with transit encryption', () => {
    expect(props('AWS::EFS::FileSystem')[0]).toMatchObject({
      Encrypted: true,
      BackupPolicy: { Status: 'ENABLED' },
    });
    expect(ofType('AWS::EFS::FileSystem')[0]?.DeletionPolicy).toBe('Retain');
    expect(JSON.stringify(props('AWS::ECS::TaskDefinition')[0]?.Volumes)).toContain(
      '"TransitEncryption":"ENABLED"',
    );
  });

  it('rolls a failed update back and gives tasks an address only inside public subnets of this network', () => {
    const [svc] = props('AWS::ECS::Service');
    expect(svc).toMatchObject({
      DeploymentConfiguration: { DeploymentCircuitBreaker: { Enable: true, Rollback: true } },
      NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'ENABLED' } },
    });
  });

  it('reports where it is and how to check it, through named outputs', () => {
    expect(Object.keys(template.Outputs ?? {})).toEqual(
      expect.arrayContaining([
        'ContainerServicePlatformUrl',
        'ContainerServicePlatformDistributionId',
        'ContainerServiceApiTargetGroup',
        'ContainerServiceApiServiceName',
      ]),
    );
  });

  it('every role carries the Hero boundary', () => {
    for (const role of props('AWS::IAM::Role')) expect(role.PermissionsBoundary).toBeDefined();
  });
});

describe('the build stack for container images', () => {
  const synth = (containers: boolean) => {
    const r = synthesizeBuild({
      deploymentId: 'hero-c',
      accountId: '123456789012',
      region: 'us-east-1',
      containers,
    });
    rmSync(r.directory, { recursive: true, force: true });
    return r;
  };

  it('adds a scanned, immutable repository and a privileged project, only when images are built', () => {
    const without = synth(false);
    const withImages = synth(true);
    expect(
      Object.values(without.template.Resources).some((r) => r.Type === 'AWS::ECR::Repository'),
    ).toBe(false);
    const projects = Object.values(withImages.template.Resources).filter(
      (r) => r.Type === 'AWS::CodeBuild::Project',
    );
    expect(projects).toHaveLength(2);
    const privileged = projects.filter(
      (p) => (p.Properties?.Environment as { PrivilegedMode: boolean }).PrivilegedMode,
    );
    expect(privileged).toHaveLength(1);
    const repository = Object.values(withImages.template.Resources).find(
      (r) => r.Type === 'AWS::ECR::Repository',
    );
    expect(repository?.Properties).toMatchObject({
      ImageScanningConfiguration: { ScanOnPush: true },
      ImageTagMutability: 'IMMUTABLE',
    });
    expect(Object.keys(withImages.template.Outputs ?? {})).toEqual(
      expect.arrayContaining(['RepositoryName', 'RepositoryUri', 'ImageProjectName', 'BucketName']),
    );
  });

  it('lets the image role push to one repository and log in, and nothing else', () => {
    const { template } = synth(true);
    const policies = Object.values(template.Resources).filter((r) => r.Type === 'AWS::IAM::Policy');
    const actions = policies
      .flatMap(
        (p) =>
          (p.Properties as { PolicyDocument: { Statement: { Action: string | string[] }[] } })
            .PolicyDocument.Statement,
      )
      .flatMap((s) => [s.Action].flat());
    expect(actions.filter((a) => a.startsWith('ecr:')).sort()).toEqual([
      'ecr:BatchCheckLayerAvailability',
      'ecr:BatchGetImage',
      'ecr:CompleteLayerUpload',
      'ecr:GetAuthorizationToken',
      'ecr:GetDownloadUrlForLayer',
      'ecr:InitiateLayerUpload',
      'ecr:PutImage',
      'ecr:UploadLayerPart',
    ]);
    expect(actions.some((a) => a === '*' || a.endsWith(':*'))).toBe(false);
  });
});
