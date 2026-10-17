import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
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
import { destroyArtifactHash, heroError } from '@hero-cloud/core';
import type { ProjectSnapshot, ProviderApplyRequest, ProviderOutputs } from '@hero-cloud/core';
import { unzipSync } from 'fflate';
import { createBuilder } from '../build/runner.js';
import type { BuildPlan } from '../build/plan.js';
import { loadBundle } from '../bundle.js';
import { pascal } from '../cdk/names.js';
import type { CfnTemplate } from '../cdk/synth.js';
import { createDeployer } from './deployer.js';
import type { ToolkitFactory } from './deployer.js';
import {
  endpointsFromOutputs,
  linksFor,
  listDeployedResources,
  outputsOf,
  readStackOutputs,
  retainedResources,
  sensitiveLocations,
} from './outputs.js';
import type { CloudFormationPort } from './outputs.js';

type S3Port = Pick<S3Client, 'send'>;

export interface ApplierOptions {
  /** Where approved bundles are kept (the provider's `assemblyDirectory`). */
  readonly assemblyDirectory: string;
  readonly region: string;
  readonly profile?: string;
  readonly toolkit?: ToolkitFactory;
  readonly cloudFormation?: CloudFormationPort;
  readonly s3?: S3Port;
  readonly cloudFront?: Pick<CloudFrontClient, 'send'>;
  readonly ecr?: Pick<ECRClient, 'send'>;
  readonly builder?: ReturnType<typeof createBuilder>;
  readonly sleep?: (ms: number) => Promise<void>;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  map: 'application/json',
  wasm: 'application/wasm',
};

export function contentTypeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/** Files a static site ships, as relative paths under its output folder. Never escapes the folder. */
export async function siteFilesFromSnapshot(
  snapshot: ProjectSnapshot,
  outputDirectory: string,
): Promise<Map<string, Uint8Array>> {
  const prefix = outputDirectory === '.' ? '' : `${outputDirectory}/`;
  const files = new Map<string, Uint8Array>();
  for (const file of snapshot.files) {
    if (!file.path.startsWith(prefix)) continue;
    files.set(file.path.slice(prefix.length), await snapshot.read(file.path));
  }
  return files;
}

/**
 * Applies and removes approved plans on AWS. It only ever uses the bundle stored for the plan's
 * `artifactHash`, after proving that bundle is intact; it never synthesizes again.
 */
export function createApplier(options: ApplierOptions): {
  apply(request: ProviderApplyRequest): Promise<ProviderOutputs>;
  destroy(request: ProviderApplyRequest): Promise<ProviderOutputs>;
} {
  const auth = {
    region: options.region,
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  };
  const cfn: CloudFormationPort = options.cloudFormation ?? new CloudFormationClient(auth);
  const s3: S3Port = options.s3 ?? new S3Client(auth);
  const registry: Pick<ECRClient, 'send'> = options.ecr ?? new ECRClient(auth);
  const cloudFront: Pick<CloudFrontClient, 'send'> =
    options.cloudFront ?? new CloudFrontClient(auth);

  const deployerFor = (request: ProviderApplyRequest) =>
    createDeployer({
      ...(options.toolkit === undefined ? {} : { toolkit: options.toolkit }),
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      emit: request.emit,
    });

  /**
   * Makes the site's bucket match the new files exactly: uploads them, removes what is no longer
   * part of the site, and clears the CDN's copies so visitors see the new version. An empty set is
   * refused, so a mistake can never blank a live site.
   */
  async function syncSite(
    bucket: string,
    files: ReadonlyMap<string, Uint8Array>,
    distributionId: string | undefined,
    deploymentId: string,
  ): Promise<void> {
    if (files.size === 0) throw heroError('deployment.failed', { step: 'site-files-empty' });
    for (const [path, body] of files) {
      if (path.split('/').includes('..') || path.startsWith('/')) {
        throw heroError('source.unsafe-path', { reason: 'site-file' });
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: path,
          Body: body,
          ContentType: contentTypeOf(path),
          ServerSideEncryption: 'AES256',
        }),
      );
    }
    let token: string | undefined;
    const stale: { Key: string }[] = [];
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key !== undefined && !files.has(item.Key)) stale.push({ Key: item.Key });
      }
      token = page.NextContinuationToken;
    } while (token !== undefined);
    for (let index = 0; index < stale.length; index += 1000) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: stale.slice(index, index + 1000), Quiet: true },
        }),
      );
    }
    if (distributionId !== undefined) {
      try {
        await cloudFront.send(
          new CreateInvalidationCommand({
            DistributionId: distributionId,
            InvalidationBatch: {
              CallerReference: `${deploymentId}-${String(Date.now())}`,
              Paths: { Quantity: 1, Items: ['/*'] },
            },
          }),
        );
      } catch (error) {
        throw heroError('deployment.failed', { step: 'invalidate-cache' }, error);
      }
    }
  }

  async function builtFiles(bucket: string, key: string): Promise<Map<string, Uint8Array>> {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await object.Body?.transformToByteArray();
    if (bytes === undefined) throw heroError('deployment.failed', { step: 'read-artifact' });
    return new Map(Object.entries(unzipSync(bytes)));
  }

  function emptyOf(plan: BuildPlan): boolean {
    return plan.jobs.length === 0;
  }

  return {
    async apply(request) {
      const { plan } = request;
      const environment = { accountId: plan.target.accountId, region: plan.target.region };
      const bundle = loadBundle(options.assemblyDirectory, plan.artifactHash, environment);
      const deployer = deployerFor(request);
      const parameters: Record<string, string> = { ...request.parameters };
      const artifacts: Record<string, string> = {};
      let buildBucket: string | undefined;

      if (!emptyOf(bundle.buildPlan)) {
        if (
          bundle.buildDirectory === undefined ||
          bundle.buildHash === undefined ||
          request.snapshot === undefined
        ) {
          throw heroError('approval.plan-mismatch', { reason: 'build-inputs' });
        }
        request.emit({
          type: 'phase',
          phase: 'deploy',
          status: 'started',
          at: new Date().toISOString(),
        });
        const buildStack = await deployer.deploy({
          assemblyDirectory: bundle.buildDirectory,
          artifactHash: bundle.buildHash,
          ...environment,
          approved: true,
        });
        buildBucket = buildStack.outputs.BucketName;
        const project = buildStack.outputs.ProjectName;
        const repositoryName = buildStack.outputs.RepositoryName;
        if (buildBucket === undefined || project === undefined) {
          throw heroError('deployment.failed', { step: 'build-stack-outputs' });
        }
        const builder =
          options.builder ??
          createBuilder({
            region: options.region,
            ...(options.profile === undefined ? {} : { profile: options.profile }),
            emit: request.emit,
            ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
          });
        const built = await builder.run({
          deploymentId: request.deploymentId,
          bucket: buildBucket,
          project,
          ...(buildStack.outputs.ImageProjectName === undefined
            ? {}
            : { imageProject: buildStack.outputs.ImageProjectName }),
          ...(buildStack.outputs.RepositoryUri === undefined
            ? {}
            : { repositoryUri: buildStack.outputs.RepositoryUri }),
          plan: bundle.buildPlan,
          snapshot: request.snapshot,
          sourceHash: plan.sourceHash,
          approved: true,
        });
        Object.assign(artifacts, built.artifacts);
        parameters.ArtifactBucket = buildBucket;
        for (const job of bundle.buildPlan.jobs) {
          if (job.kind === 'function') {
            parameters[`Code${pascal(job.id)}Key`] = built.artifacts[job.id] ?? '';
          }
          if (job.kind === 'image') {
            parameters.ImageRepository = repositoryName ?? '';
            parameters[`Image${pascal(job.id)}Tag`] = built.artifacts[job.id] ?? '';
          }
        }
      }

      const app = await deployer.deploy({
        assemblyDirectory: bundle.appDirectory,
        artifactHash: bundle.appHash,
        ...environment,
        parameters,
        approved: true,
      });

      // Static sites: the files go to the site's private bucket, from the build or the source.
      for (const site of bundle.buildPlan.sites) {
        const target = app.outputs[`StaticSite${pascal(site.id)}FilesBucket`];
        if (target === undefined) continue;
        let files: Map<string, Uint8Array>;
        if (site.built) {
          const key = artifacts[site.id];
          if (buildBucket === undefined || key === undefined) {
            throw heroError('deployment.failed', { step: 'site-files' });
          }
          files = await builtFiles(buildBucket, key);
        } else {
          if (request.snapshot === undefined)
            throw heroError('deployment.failed', { step: 'site-files' });
          files = await siteFilesFromSnapshot(request.snapshot, site.outputDirectory);
        }
        await syncSite(
          target,
          files,
          app.outputs[`StaticSite${pascal(site.id)}DistributionId`],
          request.deploymentId,
        );
      }

      const components = plan.changes
        .map((change) => change.id.split(':')[0] ?? '')
        .filter(
          (id) =>
            id.startsWith('static-site.') ||
            id.startsWith('http-service.') ||
            id.startsWith('container-service.'),
        );
      const ids = [...new Set(components)].map((entry) => {
        const [kind = '', id = ''] = entry.split('.');
        return { kind, id };
      });
      const resources = await listDeployedResources(cfn, request.deploymentId);
      return outputsOf({
        endpoints: endpointsFromOutputs(app.outputs, ids),
        resources,
        sensitive: sensitiveLocations(
          request.deploymentId,
          plan.requiredInputs.map((input) => ({ name: input.name, kind: input.kind })),
        ),
        links: linksFor(plan.target.region, request.deploymentId),
      });
    },

    async destroy(request) {
      const { plan } = request;
      const deployed = request.deployedArtifactHash;
      if (
        deployed === undefined ||
        plan.deploymentId !== request.deploymentId ||
        destroyArtifactHash(request.deploymentId, deployed) !== plan.artifactHash
      ) {
        throw heroError('approval.plan-mismatch', { reason: 'destroy-hash' });
      }
      const environment = { accountId: plan.target.accountId, region: plan.target.region };
      const bundle = loadBundle(options.assemblyDirectory, deployed, environment);
      const deployer = deployerFor(request);

      const template = JSON.parse(
        readFileSync(join(bundle.appDirectory, `${request.deploymentId}.template.json`), 'utf8'),
      ) as CfnTemplate;
      const before = await listDeployedResources(cfn, request.deploymentId).catch(() => []);
      const kept = retainedResources(template, before);

      await deployer.destroy({
        assemblyDirectory: bundle.appDirectory,
        artifactHash: bundle.appHash,
        ...environment,
        approved: true,
      });

      if (bundle.buildDirectory !== undefined && bundle.buildHash !== undefined) {
        const outputs: Record<string, string> = await readStackOutputs(
          cfn,
          `${request.deploymentId}-build`,
        ).catch(() => ({}));
        if (outputs.BucketName !== undefined) await emptyBucket(s3, outputs.BucketName);
        if (outputs.RepositoryName !== undefined)
          await emptyRepository(registry, outputs.RepositoryName);
        await deployer.destroy({
          assemblyDirectory: bundle.buildDirectory,
          artifactHash: bundle.buildHash,
          ...environment,
          approved: true,
        });
      }
      return {
        ...outputsOf({ endpoints: [], resources: [], sensitive: [], links: [] }),
        kept,
      } satisfies ProviderOutputs;
    },
  };
}

/** Removes every image, so the stack that owns the repository can be deleted. */
export async function emptyRepository(
  registry: Pick<ECRClient, 'send'>,
  repositoryName: string,
): Promise<void> {
  let token: string | undefined;
  do {
    const page = await registry.send(
      new ListImagesCommand({
        repositoryName,
        ...(token === undefined ? {} : { nextToken: token }),
      }),
    );
    const ids = page.imageIds ?? [];
    for (let index = 0; index < ids.length; index += 100) {
      await registry.send(
        new BatchDeleteImageCommand({ repositoryName, imageIds: ids.slice(index, index + 100) }),
      );
    }
    token = page.nextToken;
  } while (token !== undefined);
}

/** Removes every object and every version, so the stack that owns the bucket can be deleted. */
export async function emptyBucket(s3: S3Port, bucket: string): Promise<void> {
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  for (;;) {
    const page = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
        ...(versionMarker === undefined ? {} : { VersionIdMarker: versionMarker }),
      }),
    );
    const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]
      .filter((item) => item.Key !== undefined)
      .map((item) => ({ Key: item.Key as string, VersionId: item.VersionId }));
    if (objects.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }),
      );
    }
    if (page.IsTruncated !== true) return;
    keyMarker = page.NextKeyMarker;
    versionMarker = page.NextVersionIdMarker;
  }
}
