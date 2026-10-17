import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudFormationClient, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { BatchDeleteImageCommand, ECRClient, ListImagesCommand } from '@aws-sdk/client-ecr';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Component, DeploymentPlan, ProjectSnapshot } from '@hero-cloud/core';
import { destroyArtifactHash, sealPlan } from '@hero-cloud/core';
import { mockClient } from 'aws-sdk-client-mock';
import { zipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { createAwsProvider } from '../provider.js';
import { contentTypeOf, createApplier, emptyRepository } from './apply.js';
import type { ToolkitPort } from './deployer.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const component = (
  kind: Component['kind'],
  id: string,
  settings: Component['settings'],
): Component => ({
  id,
  kind,
  capability: kind,
  settings,
  rationale: [],
});

const ACCOUNT = '123456789012';
const REGION = 'us-east-1';

async function planFor(components: Component[]) {
  const root = mkdtempSync(join(tmpdir(), 'hero-apply-'));
  roots.push(root);
  const described = await createAwsProvider({ assemblyDirectory: root }).describe({
    strategy: 'serverless',
    components,
    region: REGION,
    accountId: ACCOUNT,
    deploymentId: 'hero-shop',
    inputs: [{ name: 'API_KEY', kind: 'secret' }],
    allowNetwork: false,
  });
  const plan: DeploymentPlan = sealPlan({
    application: 'shop',
    specVersion: '1',
    sourceHash: 'ab'.repeat(32),
    strategy: 'serverless',
    strategyRationale: [],
    target: { provider: 'aws', region: REGION, accountId: ACCOUNT },
    changes: described.changes,
    warnings: [],
    requiredInputs: [{ name: 'API_KEY', kind: 'secret', reason: { code: 'input.secret' } }],
    artifactHash: described.artifactHash,
  });
  return { root, plan };
}

function snapshot(files: Record<string, string>): ProjectSnapshot {
  const enc = new TextEncoder();
  return {
    hash: 'ab'.repeat(32),
    files: Object.entries(files).map(([path, c]) => ({ path, size: c.length, sha256: '' })),
    skipped: [],
    read: (p) => Promise.resolve(enc.encode(files[p] ?? '')),
    dispose: () => Promise.resolve(),
  };
}

function fakeToolkit(outputsByStack: (calls: number) => Record<string, string>) {
  const deploys: { parameters: Record<string, string> }[] = [];
  const destroys: number[] = [];
  const toolkit: ToolkitPort = {
    fromAssemblyDirectory: (d) => Promise.resolve(d),
    deploy: (_s, o) => {
      deploys.push({ parameters: { ...o.parameters } });
      return Promise.resolve({ stacks: [{ outputs: outputsByStack(deploys.length) }] });
    },
    destroy: () => {
      destroys.push(1);
      return Promise.resolve({ stacks: [{ stackExisted: true }] });
    },
    diff: () => Promise.resolve({}),
  };
  return { toolkit, deploys, destroys };
}

describe('contentTypeOf', () => {
  it('knows web file types and falls back to binary', () => {
    expect(contentTypeOf('a/b.HTML')).toContain('text/html');
    expect(contentTypeOf('x.woff2')).toBe('font/woff2');
    expect(contentTypeOf('noext')).toBe('application/octet-stream');
  });
});

describe('createApplier.apply', () => {
  it('ships a finished static site straight from the source', async () => {
    const { root, plan } = await planFor([
      component('static-site', 'site', { outputDirectory: 'public' }),
    ]);
    const s3 = mockClient(S3Client);
    const cfn = mockClient(CloudFormationClient);
    s3.on(PutObjectCommand).resolves({});
    s3.on(ListObjectsV2Command).resolves({});
    cfn.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [
        {
          LogicalResourceId: 'B',
          ResourceType: 'AWS::S3::Bucket',
          PhysicalResourceId: 'bkt',
          LastUpdatedTimestamp: new Date(),
          ResourceStatus: 'CREATE_COMPLETE',
        },
      ],
    });
    const { toolkit, deploys } = fakeToolkit(() => ({
      StaticSiteSiteUrl: 'https://d1.cloudfront.net',
      StaticSiteSiteFilesBucket: 'files-bucket',
    }));
    try {
      const out = await createApplier({
        assemblyDirectory: root,
        region: REGION,
        toolkit: () => Promise.resolve(toolkit),
        cloudFormation: new CloudFormationClient({ region: REGION }),
        s3: new S3Client({ region: REGION }),
      }).apply({
        plan,
        snapshot: snapshot({ 'public/index.html': '<h1>hi</h1>', 'README.md': 'no' }),
        parameters: {},
        deploymentId: 'hero-shop',
        emit: () => undefined,
      });
      expect(deploys).toHaveLength(1);
      expect(out.endpoints).toEqual([
        { kind: 'url', label: 'website', value: 'https://d1.cloudfront.net', public: true },
      ]);
      const puts = s3.commandCalls(PutObjectCommand).map((c) => c.args[0].input);
      expect(puts).toHaveLength(1);
      expect(puts[0]).toMatchObject({
        Bucket: 'files-bucket',
        Key: 'index.html',
        ContentType: 'text/html; charset=utf-8',
      });
      expect(out.sensitiveOutputs).toEqual([
        { name: 'API_KEY', location: 'ssm:/hero/hero-shop/API_KEY' },
      ]);
      expect(out.resources).toHaveLength(1);
      expect(out.links.map((l) => l.kind)).toEqual(['console', 'logs', 'cost']);
    } finally {
      s3.restore();
      cfn.restore();
    }
  });

  it('builds a service first, then deploys it with the artifact key as a parameter', async () => {
    const { root, plan } = await planFor([
      component('http-service', 'api', { startCommand: 'node server.js' }),
    ]);
    const s3 = mockClient(S3Client);
    const cfn = mockClient(CloudFormationClient);
    cfn.on(ListStackResourcesCommand).resolves({ StackResourceSummaries: [] });
    const { toolkit, deploys } = fakeToolkit((n): Record<string, string> =>
      n === 1
        ? { BucketName: 'build-bucket', ProjectName: 'hero-shop-build' }
        : { HttpServiceApiUrl: 'https://abc.execute-api.us-east-1.amazonaws.com' },
    );
    const built: string[] = [];
    try {
      const out = await createApplier({
        assemblyDirectory: root,
        region: REGION,
        toolkit: () => Promise.resolve(toolkit),
        cloudFormation: new CloudFormationClient({ region: REGION }),
        s3: new S3Client({ region: REGION }),
        builder: {
          run: (r) => {
            built.push(r.bucket);
            return Promise.resolve({ artifacts: { api: 'artifacts/hero-shop/Api/x.zip' } });
          },
        },
      }).apply({
        plan,
        snapshot: snapshot({ 'server.js': 'x' }),
        parameters: { BudgetEmail: 'a@b.co' },
        deploymentId: 'hero-shop',
        emit: () => undefined,
      });
      expect(built).toEqual(['build-bucket']);
      expect(deploys).toHaveLength(2);
      expect(deploys[1]?.parameters).toEqual({
        BudgetEmail: 'a@b.co',
        ArtifactBucket: 'build-bucket',
        CodeApiKey: 'artifacts/hero-shop/Api/x.zip',
      });
      expect(out.endpoints[0]).toMatchObject({ label: 'api', public: true });
    } finally {
      s3.restore();
      cfn.restore();
    }
  });

  it('uploads the files a build produced for a static site', async () => {
    const { root, plan } = await planFor([
      component('static-site', 'site', { outputDirectory: 'dist', buildCommand: 'npm run build' }),
    ]);
    const s3 = mockClient(S3Client);
    const cfn = mockClient(CloudFormationClient);
    cfn.on(ListStackResourcesCommand).resolves({ StackResourceSummaries: [] });
    const zip = zipSync({
      'index.html': new TextEncoder().encode('<p>built</p>'),
      'a/app.js': new TextEncoder().encode('1'),
    });
    s3.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: () => Promise.resolve(zip) } as never,
    });
    s3.on(PutObjectCommand).resolves({});
    s3.on(ListObjectsV2Command).resolves({});
    const { toolkit } = fakeToolkit((n): Record<string, string> =>
      n === 1
        ? { BucketName: 'build-bucket', ProjectName: 'p' }
        : { StaticSiteSiteUrl: 'https://x.cloudfront.net', StaticSiteSiteFilesBucket: 'files' },
    );
    try {
      await createApplier({
        assemblyDirectory: root,
        region: REGION,
        toolkit: () => Promise.resolve(toolkit),
        cloudFormation: new CloudFormationClient({ region: REGION }),
        s3: new S3Client({ region: REGION }),
        builder: {
          run: () => Promise.resolve({ artifacts: { site: 'artifacts/hero-shop/Site/x.zip' } }),
        },
      }).apply({
        plan,
        snapshot: snapshot({ 'package.json': '{}' }),
        parameters: {},
        deploymentId: 'hero-shop',
        emit: () => undefined,
      });
      const keys = s3
        .commandCalls(PutObjectCommand)
        .map((c) => c.args[0].input.Key)
        .sort();
      expect(keys).toEqual(['a/app.js', 'index.html']);
    } finally {
      s3.restore();
      cfn.restore();
    }
  });

  it('makes the site match the new files: removes what is gone and clears the CDN copies', async () => {
    const { root, plan } = await planFor([
      component('static-site', 'site', { outputDirectory: 'public' }),
    ]);
    const s3 = mockClient(S3Client);
    const cfn = mockClient(CloudFormationClient);
    const cdn = mockClient(CloudFrontClient);
    s3.on(PutObjectCommand).resolves({});
    s3.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: 'index.html' }, { Key: 'old/page.html' }, { Key: 'gone.css' }],
    });
    s3.on(DeleteObjectsCommand).resolves({});
    cdn.on(CreateInvalidationCommand).resolves({});
    cfn.on(ListStackResourcesCommand).resolves({ StackResourceSummaries: [] });
    const { toolkit } = fakeToolkit(() => ({
      StaticSiteSiteUrl: 'https://d1.cloudfront.net',
      StaticSiteSiteFilesBucket: 'files-bucket',
      StaticSiteSiteDistributionId: 'E123',
    }));
    try {
      await createApplier({
        assemblyDirectory: root,
        region: REGION,
        toolkit: () => Promise.resolve(toolkit),
        cloudFormation: new CloudFormationClient({ region: REGION }),
        s3: new S3Client({ region: REGION }),
        cloudFront: new CloudFrontClient({ region: REGION }),
      }).apply({
        plan,
        snapshot: snapshot({ 'public/index.html': '<h1>v2</h1>' }),
        parameters: {},
        deploymentId: 'hero-shop',
        emit: () => undefined,
      });
      expect(s3.commandCalls(DeleteObjectsCommand)[0]?.args[0].input.Delete?.Objects).toEqual([
        { Key: 'old/page.html' },
        { Key: 'gone.css' },
      ]);
      expect(cdn.commandCalls(CreateInvalidationCommand)[0]?.args[0].input).toMatchObject({
        DistributionId: 'E123',
        InvalidationBatch: { Paths: { Quantity: 1, Items: ['/*'] } },
      });
    } finally {
      s3.restore();
      cfn.restore();
      cdn.restore();
    }
  });

  it('never blanks a live site: an empty set of files is refused', async () => {
    const { root, plan } = await planFor([
      component('static-site', 'site', { outputDirectory: 'public' }),
    ]);
    const s3 = mockClient(S3Client);
    const cfn = mockClient(CloudFormationClient);
    cfn.on(ListStackResourcesCommand).resolves({ StackResourceSummaries: [] });
    const { toolkit } = fakeToolkit(() => ({
      StaticSiteSiteUrl: 'https://d1.cloudfront.net',
      StaticSiteSiteFilesBucket: 'files-bucket',
    }));
    try {
      await expect(
        createApplier({
          assemblyDirectory: root,
          region: REGION,
          toolkit: () => Promise.resolve(toolkit),
          cloudFormation: new CloudFormationClient({ region: REGION }),
          s3: new S3Client({ region: REGION }),
        }).apply({
          plan,
          snapshot: snapshot({ 'README.md': 'nothing under public' }),
          parameters: {},
          deploymentId: 'hero-shop',
          emit: () => undefined,
        }),
      ).rejects.toMatchObject({ params: { step: 'site-files-empty' } });
      expect(s3.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
    } finally {
      s3.restore();
      cfn.restore();
    }
  });

  it('refuses a plan whose stored bundle does not match', async () => {
    const { root, plan } = await planFor([component('static-site', 'site', {})]);
    const forged = sealPlan({ ...plan, artifactHash: 'f'.repeat(64) });
    const { toolkit, deploys } = fakeToolkit(() => ({}));
    await expect(
      createApplier({
        assemblyDirectory: root,
        region: REGION,
        toolkit: () => Promise.resolve(toolkit),
        cloudFormation: new CloudFormationClient({ region: REGION }),
        s3: new S3Client({ region: REGION }),
      }).apply({
        plan: forged,
        snapshot: undefined,
        parameters: {},
        deploymentId: 'hero-shop',
        emit: () => undefined,
      }),
    ).rejects.toThrow();
    expect(deploys).toEqual([]);
  });
});

describe('createApplier.destroy', () => {
  it('removes the app, empties and removes the build stack, and reports what it kept', async () => {
    const { root, plan: deployed } = await planFor([
      component('key-value-table', 'kv', { partitionKey: 'id' }),
      component('http-service', 'api', { startCommand: 'node s.js' }),
    ]);
    const destroyPlan = sealPlan({
      ...deployed,
      intent: 'destroy',
      deploymentId: 'hero-shop',
      changes: [],
      artifactHash: destroyArtifactHash('hero-shop', deployed.artifactHash),
    });
    const s3 = mockClient(S3Client);
    const cfn = mockClient(CloudFormationClient);
    cfn.on(ListStackResourcesCommand).resolves({
      StackResourceSummaries: [],
    });
    s3.on(ListObjectVersionsCommand).resolves({
      Versions: [{ Key: 'a', VersionId: '1' }],
      DeleteMarkers: [{ Key: 'b', VersionId: '2' }],
      IsTruncated: false,
    });
    s3.on(DeleteObjectsCommand).resolves({});
    const { toolkit, destroys } = fakeToolkit(() => ({}));
    // The build stack outputs come from CloudFormation.
    const { DescribeStacksCommand } = await import('@aws-sdk/client-cloudformation');
    cfn.on(DescribeStacksCommand).resolves({
      Stacks: [
        {
          StackName: 'x',
          StackStatus: 'CREATE_COMPLETE',
          CreationTime: new Date(),
          Outputs: [{ OutputKey: 'BucketName', OutputValue: 'build-bucket' }],
        },
      ],
    });
    try {
      const applier = createApplier({
        assemblyDirectory: root,
        region: REGION,
        toolkit: () => Promise.resolve(toolkit),
        cloudFormation: new CloudFormationClient({ region: REGION }),
        s3: new S3Client({ region: REGION }),
      });
      await applier.destroy({
        plan: destroyPlan,
        snapshot: undefined,
        parameters: {},
        deploymentId: 'hero-shop',
        deployedArtifactHash: deployed.artifactHash,
        emit: () => undefined,
      });
      expect(destroys).toHaveLength(2);
      expect(s3.commandCalls(DeleteObjectsCommand)[0]?.args[0].input.Delete?.Objects).toEqual([
        { Key: 'a', VersionId: '1' },
        { Key: 'b', VersionId: '2' },
      ]);
    } finally {
      s3.restore();
      cfn.restore();
    }
  });

  it('refuses a destroy plan that does not cover the deployment it names', async () => {
    const { root, plan } = await planFor([component('static-site', 'site', {})]);
    const wrong = sealPlan({
      ...plan,
      intent: 'destroy',
      deploymentId: 'hero-shop',
      artifactHash: 'e'.repeat(64),
    });
    const { toolkit, destroys } = fakeToolkit(() => ({}));
    await expect(
      createApplier({
        assemblyDirectory: root,
        region: REGION,
        toolkit: () => Promise.resolve(toolkit),
        cloudFormation: new CloudFormationClient({ region: REGION }),
        s3: new S3Client({ region: REGION }),
      }).destroy({
        plan: wrong,
        snapshot: undefined,
        parameters: {},
        deploymentId: 'hero-shop',
        deployedArtifactHash: plan.artifactHash,
        emit: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'approval.plan-mismatch' });
    expect(destroys).toEqual([]);
  });
});

describe('createApplier.apply for a container', () => {
  it('builds the image in the privileged project, then deploys with its repository and tag', async () => {
    const { root, plan } = await planFor([
      component('container-service', 'api', {
        runtime: 'python',
        port: 8000,
        build: 'buildpack',
        cpu: 256,
        memoryMb: 512,
      }),
    ]);
    const s3 = mockClient(S3Client);
    const cfn = mockClient(CloudFormationClient);
    cfn.on(ListStackResourcesCommand).resolves({ StackResourceSummaries: [] });
    const { toolkit, deploys } = fakeToolkit((n): Record<string, string> =>
      n === 1
        ? {
            BucketName: 'build-bucket',
            ProjectName: 'hero-shop-build',
            ImageProjectName: 'hero-shop-image-build',
            RepositoryName: 'hero-shop',
            RepositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/hero-shop',
          }
        : { ContainerServicePlatformUrl: 'https://d9.cloudfront.net' },
    );
    const asked: { imageProject?: string; repositoryUri?: string }[] = [];
    try {
      const out = await createApplier({
        assemblyDirectory: root,
        region: REGION,
        toolkit: () => Promise.resolve(toolkit),
        cloudFormation: new CloudFormationClient({ region: REGION }),
        s3: new S3Client({ region: REGION }),
        builder: {
          run: (r) => {
            asked.push({
              ...(r.imageProject === undefined ? {} : { imageProject: r.imageProject }),
              ...(r.repositoryUri === undefined ? {} : { repositoryUri: r.repositoryUri }),
            });
            return Promise.resolve({ artifacts: { api: 'abababababababab' } });
          },
        },
      }).apply({
        plan,
        snapshot: snapshot({ 'app.py': 'x' }),
        parameters: {},
        deploymentId: 'hero-shop',
        emit: () => undefined,
      });
      expect(asked).toEqual([
        {
          imageProject: 'hero-shop-image-build',
          repositoryUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/hero-shop',
        },
      ]);
      expect(deploys[1]?.parameters).toEqual({
        ArtifactBucket: 'build-bucket',
        ImageRepository: 'hero-shop',
        ImageApiTag: 'abababababababab',
      });
      expect(out.endpoints).toEqual([
        { kind: 'url', label: 'app', value: 'https://d9.cloudfront.net', public: true },
      ]);
    } finally {
      s3.restore();
      cfn.restore();
    }
  });
});

describe('emptyRepository', () => {
  it('removes every image of the repository, a page at a time, in groups the service accepts', async () => {
    const ecr = mockClient(ECRClient);
    const ids = Array.from({ length: 230 }, (_, i) => ({ imageTag: `t${String(i)}` }));
    ecr
      .on(ListImagesCommand)
      .resolvesOnce({ imageIds: ids.slice(0, 150), nextToken: 'more' })
      .resolves({ imageIds: ids.slice(150) });
    ecr.on(BatchDeleteImageCommand).resolves({});
    try {
      await emptyRepository(new ECRClient({ region: REGION }), 'hero-shop');
      const sizes = ecr
        .commandCalls(BatchDeleteImageCommand)
        .map((c) => c.args[0].input.imageIds?.length);
      expect(sizes).toEqual([100, 50, 80]);
      expect(ecr.commandCalls(BatchDeleteImageCommand)[0]?.args[0].input.repositoryName).toBe(
        'hero-shop',
      );
    } finally {
      ecr.restore();
    }
  });
});
