import { createHash } from 'node:crypto';
import {
  BatchGetBuildsCommand,
  CodeBuildClient,
  StartBuildCommand,
} from '@aws-sdk/client-codebuild';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Component, HeroEvent, ProjectSnapshot } from '@hero-cloud/core';
import { mockClient } from 'aws-sdk-client-mock';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildPlanFor, artifactKey } from './plan.js';
import { createBuilder, zipSnapshot } from './runner.js';

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function snapshot(files: Record<string, string>, hash = 'ab'.repeat(32)): ProjectSnapshot {
  const content = new Map(Object.entries(files).map(([p, c]) => [p, new TextEncoder().encode(c)]));
  return {
    hash,
    files: [...content].map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha(bytes) })),
    skipped: [],
    read: (path) => Promise.resolve(content.get(path) ?? new Uint8Array()),
    dispose: () => Promise.resolve(),
  };
}

const api: Component = {
  id: 'api',
  kind: 'http-service',
  capability: 'http-service',
  settings: { startCommand: 'node server.js', buildCommand: 'npm run build' },
  rationale: [],
};

function harness() {
  const s3 = mockClient(S3Client);
  const cb = mockClient(CodeBuildClient);
  const events: HeroEvent[] = [];
  const builder = createBuilder({
    region: 'us-east-1',
    s3: new S3Client({ region: 'us-east-1' }),
    codeBuild: new CodeBuildClient({ region: 'us-east-1' }),
    emit: (e) => events.push(e),
    sleep: () => Promise.resolve(),
    pollMs: 1000,
    maxWaitMs: 5000,
  });
  const request = (over = {}) => ({
    deploymentId: 'hero-shop',
    bucket: 'hero-shop-build-artifacts',
    project: 'hero-shop-build',
    plan: buildPlanFor([api]),
    snapshot: snapshot({ 'package.json': '{}', 'server.js': 'x' }),
    sourceHash: 'ab'.repeat(32),
    approved: true,
    ...over,
  });
  return { s3, cb, events, builder, request };
}

describe('zipSnapshot', () => {
  it('packs every file, deterministically', async () => {
    const snap = snapshot({ 'b.txt': 'two', 'a/c.txt': 'one' });
    const first = await zipSnapshot(snap);
    expect(Buffer.from(first).equals(Buffer.from(await zipSnapshot(snap)))).toBe(true);
    const files = unzipSync(first);
    expect(Object.keys(files).sort()).toEqual(['a/c.txt', 'b.txt']);
    expect(new TextDecoder().decode(files['b.txt'])).toBe('two');
  });

  it('refuses a file whose content changed since it was reviewed', async () => {
    const snap = snapshot({ 'a.txt': 'one' });
    const tampered: ProjectSnapshot = {
      ...snap,
      read: () => Promise.resolve(new TextEncoder().encode('evil')),
    };
    await expect(zipSnapshot(tampered)).rejects.toMatchObject({ code: 'approval.plan-mismatch' });
  });
});

describe('createBuilder', () => {
  it('uploads the source, builds with a generated buildspec, and returns the artifact key', async () => {
    const { s3, cb, events, builder, request } = harness();
    s3.on(PutObjectCommand).resolves({});
    cb.on(StartBuildCommand).resolves({ build: { id: 'b-1' } });
    cb.on(BatchGetBuildsCommand)
      .resolvesOnce({ builds: [{ buildStatus: 'IN_PROGRESS' }] })
      .resolves({ builds: [{ buildStatus: 'SUCCEEDED' }] });
    const result = await builder.run(request());
    const key = artifactKey('hero-shop', buildPlanFor([api]).jobs[0]!, 'ab'.repeat(32));
    expect(result.artifacts).toEqual({ api: key });

    const put = s3.commandCalls(PutObjectCommand)[0]?.args[0].input;
    expect(put).toMatchObject({
      Bucket: 'hero-shop-build-artifacts',
      Key: `source/hero-shop/${'ab'.repeat(8)}.zip`,
      ServerSideEncryption: 'AES256',
    });
    const start = cb.commandCalls(StartBuildCommand)[0]?.args[0].input;
    expect(start).toMatchObject({
      projectName: 'hero-shop-build',
      sourceTypeOverride: 'S3',
      artifactsOverride: {
        path: 'artifacts/hero-shop/Api',
        packaging: 'ZIP',
        namespaceType: 'NONE',
      },
    });
    expect(String(start?.buildspecOverride)).toContain('npm run build');
    // No credentials or environment are handed to the build.
    expect(start?.environmentVariablesOverride).toBeUndefined();
    expect(events.map((e) => (e.type === 'notice' ? e.code : e.type))).toEqual([
      'build.source-uploaded',
      'build.started',
      'build.finished',
    ]);
  });

  it('does nothing without approval or when the source is not the reviewed one', async () => {
    const { s3, cb, builder, request } = harness();
    await expect(builder.run(request({ approved: false }))).rejects.toThrow();
    await expect(builder.run(request({ sourceHash: 'cd'.repeat(32) }))).rejects.toMatchObject({
      code: 'approval.plan-mismatch',
    });
    expect(s3.calls()).toHaveLength(0);
    expect(cb.calls()).toHaveLength(0);
  });

  it('reports a failed build with its job and phase, never its log text', async () => {
    const { s3, cb, builder, request } = harness();
    s3.on(PutObjectCommand).resolves({});
    cb.on(StartBuildCommand).resolves({ build: { id: 'b-1' } });
    cb.on(BatchGetBuildsCommand).resolves({
      builds: [{ buildStatus: 'FAILED', currentPhase: 'BUILD' }],
    });
    await expect(builder.run(request())).rejects.toMatchObject({
      code: 'deployment.failed',
      params: { step: 'build', job: 'api', status: 'FAILED', phase: 'BUILD' },
    });
  });

  it('gives up on a build that never finishes', async () => {
    const { s3, cb, builder, request } = harness();
    s3.on(PutObjectCommand).resolves({});
    cb.on(StartBuildCommand).resolves({ build: { id: 'b-1' } });
    cb.on(BatchGetBuildsCommand).resolves({ builds: [{ buildStatus: 'IN_PROGRESS' }] });
    await expect(builder.run(request())).rejects.toMatchObject({
      params: { status: 'TIMEOUT' },
    });
  });

  it('wraps upload and start failures', async () => {
    const { s3, cb, builder, request } = harness();
    s3.on(PutObjectCommand).rejects(new Error('AccessDenied'));
    await expect(builder.run(request())).rejects.toMatchObject({
      params: { step: 'upload-source' },
    });
    s3.on(PutObjectCommand).resolves({});
    cb.on(StartBuildCommand).rejects(new Error('nope'));
    await expect(builder.run(request())).rejects.toMatchObject({ params: { step: 'start-build' } });
  });
});
