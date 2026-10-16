import { createHash } from 'node:crypto';
import {
  BatchGetBuildsCommand,
  CodeBuildClient,
  StartBuildCommand,
} from '@aws-sdk/client-codebuild';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { heroError } from '@hero-cloud/core';
import type { HeroEvent, ProjectSnapshot } from '@hero-cloud/core';
import { zipSync } from 'fflate';
import { generateBuildspec } from './buildspec.js';
import { artifactKey, sourceKey } from './plan.js';
import type { BuildPlan } from './plan.js';

/** The parts of the AWS clients Hero uses, so tests can use mocks. */
export type S3Port = Pick<S3Client, 'send'>;
export type CodeBuildPort = Pick<CodeBuildClient, 'send'>;

export interface BuilderOptions {
  readonly region: string;
  readonly profile?: string;
  readonly s3?: S3Port;
  readonly codeBuild?: CodeBuildPort;
  readonly emit?: (event: HeroEvent) => void;
  /** Milliseconds between status checks. */
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Longest wait for one build, in milliseconds. Defaults to the plan's timeout plus a margin. */
  readonly maxWaitMs?: number;
}

export interface BuildRequest {
  readonly deploymentId: string;
  /** The bucket and project created by the build stack. */
  readonly bucket: string;
  readonly project: string;
  readonly plan: BuildPlan;
  readonly snapshot: ProjectSnapshot;
  /** The source hash the person approved. The snapshot must match it. */
  readonly sourceHash: string;
  readonly approved: boolean;
}

export interface BuildResult {
  /** Component id to the key of its artifact in the bucket. */
  readonly artifacts: Readonly<Record<string, string>>;
}

const FIXED_TIME = new Date('2020-01-01T00:00:00Z');

/**
 * Packs the snapshot into a ZIP. Every file is checked against the hash recorded when the project
 * was analyzed, so the source that is built is exactly the source that was reviewed. Times are
 * fixed so equal sources give equal archives.
 */
export async function zipSnapshot(snapshot: ProjectSnapshot): Promise<Uint8Array> {
  const entries: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {};
  for (const file of [...snapshot.files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const bytes = await snapshot.read(file.path);
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw heroError('approval.plan-mismatch', { reason: 'source-changed' });
    }
    entries[file.path] = [bytes, { mtime: FIXED_TIME, level: 6 }];
  }
  return zipSync(entries);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Uploads the reviewed source to the user's own bucket and builds it in their CodeBuild project,
 * one job at a time. The buildspec is generated here and sent with each build, so nothing in the
 * project can change what runs. No credentials are passed to the build: it runs with the build
 * role alone. Build logs stay in the user's CloudWatch; only phase names are reported.
 */
export function createBuilder(options: BuilderOptions): {
  run(request: BuildRequest): Promise<BuildResult>;
} {
  const auth = {
    region: options.region,
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  };
  const s3: S3Port = options.s3 ?? new S3Client(auth);
  const codeBuild: CodeBuildPort = options.codeBuild ?? new CodeBuildClient(auth);
  const sleep = options.sleep ?? defaultSleep;
  const pollMs = options.pollMs ?? 5000;

  const notice = (code: string): void => {
    options.emit?.({ type: 'notice', level: 'info', code });
  };

  return {
    async run(request) {
      if (!request.approved) throw heroError('approval.unknown-challenge');
      if (request.snapshot.hash !== request.sourceHash) {
        throw heroError('approval.plan-mismatch', { reason: 'source-changed' });
      }
      const key = sourceKey(request.deploymentId, request.sourceHash);
      const archive = await zipSnapshot(request.snapshot);
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: request.bucket,
            Key: key,
            Body: archive,
            ContentType: 'application/zip',
            ServerSideEncryption: 'AES256',
          }),
        );
      } catch (error) {
        throw heroError('deployment.failed', { step: 'upload-source' }, error);
      }
      notice('build.source-uploaded');

      const artifacts: Record<string, string> = {};
      const maxWait = options.maxWaitMs ?? (request.plan.timeoutMinutes + 5) * 60_000;
      for (const job of request.plan.jobs) {
        const target = artifactKey(request.deploymentId, job, request.sourceHash);
        const slash = target.lastIndexOf('/');
        let id: string | undefined;
        try {
          const started = await codeBuild.send(
            new StartBuildCommand({
              projectName: request.project,
              buildspecOverride: generateBuildspec(job),
              sourceTypeOverride: 'S3',
              sourceLocationOverride: `${request.bucket}/${key}`,
              artifactsOverride: {
                type: 'S3',
                location: request.bucket,
                path: target.slice(0, slash),
                name: target.slice(slash + 1),
                namespaceType: 'NONE',
                packaging: 'ZIP',
              },
              timeoutInMinutesOverride: request.plan.timeoutMinutes,
            }),
          );
          id = started.build?.id;
        } catch (error) {
          throw heroError('deployment.failed', { step: 'start-build', job: job.id }, error);
        }
        if (id === undefined)
          throw heroError('deployment.failed', { step: 'start-build', job: job.id });
        notice('build.started');

        let waited = 0;
        for (;;) {
          const result = await codeBuild.send(new BatchGetBuildsCommand({ ids: [id] }));
          const build = result.builds?.[0];
          if (build?.buildStatus === 'SUCCEEDED') break;
          if (build !== undefined && build.buildStatus !== 'IN_PROGRESS') {
            throw heroError('deployment.failed', {
              step: 'build',
              job: job.id,
              status: build.buildStatus ?? 'UNKNOWN',
              phase: build.currentPhase ?? 'UNKNOWN',
            });
          }
          if (waited >= maxWait) {
            throw heroError('deployment.failed', { step: 'build', job: job.id, status: 'TIMEOUT' });
          }
          await sleep(pollMs);
          waited += pollMs;
        }
        notice('build.finished');
        artifacts[job.id] = target;
      }
      return { artifacts };
    },
  };
}
