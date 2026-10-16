import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Component } from '@hero-cloud/core';
import { afterAll, describe, expect, it } from 'vitest';
import { changesFromTemplate } from '../changes.js';
import { synthesize } from '../cdk/synth.js';
import { actionOf, applyDiff, diffAgainstDeployed } from './diff.js';
import type { ResourceDifferenceLike, StackDiffLike } from './diff.js';
import type { ToolkitPort } from './deployer.js';

const kv: Component = {
  id: 'kv',
  kind: 'key-value-table',
  capability: 'key-value-data',
  settings: { partitionKey: 'id' },
  rationale: [],
};
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const difference = (over: Partial<ResourceDifferenceLike>): ResourceDifferenceLike => ({
  isAddition: false,
  isRemoval: false,
  ...over,
});

describe('actionOf', () => {
  it.each([
    [{ isAddition: true }, 'create', false],
    [{ isRemoval: true }, 'delete', true],
    [{ changeImpact: 'WILL_DESTROY' }, 'delete', true],
    [{ changeImpact: 'WILL_REPLACE' }, 'replace', true],
    [{ changeImpact: 'MAY_REPLACE' }, 'replace', true],
    [{ changeImpact: 'WILL_UPDATE' }, 'update', false],
    [{ changeImpact: 'WILL_CREATE' }, 'create', false],
    [{ changeImpact: 'WILL_ORPHAN' }, 'update', true],
  ] as const)('%j is %s (destructive: %s)', (input, action, destructive) => {
    expect(actionOf(difference(input))).toEqual({ action, destructive });
  });

  it('omits what will not change', () => {
    expect(actionOf(difference({ changeImpact: 'NO_CHANGE' }))).toBeNull();
  });
});

describe('applyDiff', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hero-diff-test-'));
  dirs.push(directory);
  const assembly = synthesize(
    { deploymentId: 'hero-d', accountId: '123456789012', region: 'us-east-1', components: [kv] },
    directory,
  );
  const fresh = changesFromTemplate(assembly.template, 'us-east-1', 'hero-d');
  const tableId = String(
    fresh.find((c) => c.resource.type === 'dynamodb-table')?.details?.logicalId,
  );

  it('marks a replaced table destructive and keeps its explanation', () => {
    const diff: StackDiffLike = {
      resources: { changes: { [tableId]: difference({ changeImpact: 'WILL_REPLACE' }) } },
    };
    const [change, ...rest] = applyDiff(fresh, diff, 'us-east-1', 'hero-d');
    expect(rest).toEqual([]);
    expect(change).toMatchObject({ action: 'replace', destructive: true });
    expect(change?.rationale.map((r) => r.code)).toContain('guardrail.backups');
  });

  it('lists a resource that left the template as a deletion, and drops unchanged ones', () => {
    const diff: StackDiffLike = {
      resources: {
        changes: {
          [tableId]: difference({ changeImpact: 'NO_CHANGE' }),
          OldQueue: difference({ isRemoval: true, oldResourceType: 'AWS::SQS::Queue' }),
        },
      },
    };
    const changes = applyDiff(fresh, diff, 'us-east-1', 'hero-d');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      action: 'delete',
      destructive: true,
      resource: { type: 'other-resource', name: 'OldQueue' },
      details: { cloudFormationType: 'AWS::SQS::Queue' },
    });
  });
});

describe('diffAgainstDeployed', () => {
  it('verifies the assembly, then asks the toolkit and never deploys', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hero-diff-test-'));
    dirs.push(directory);
    const assembly = synthesize(
      { deploymentId: 'hero-d', accountId: '123456789012', region: 'us-east-1', components: [kv] },
      directory,
    );
    const calls: string[] = [];
    const toolkit: ToolkitPort = {
      fromAssemblyDirectory: () => Promise.resolve({}),
      deploy: () => {
        calls.push('deploy');
        return Promise.reject(new Error('must not deploy'));
      },
      destroy: () => Promise.reject(new Error('must not destroy')),
      diff: () => {
        calls.push('diff');
        return Promise.resolve({
          [assembly.stackName]: {
            resources: { changes: { Gone: difference({ isRemoval: true }) } },
          },
        });
      },
    };
    const request = {
      assemblyDirectory: directory,
      artifactHash: assembly.hash,
      accountId: '123456789012',
      region: 'us-east-1',
      deploymentId: 'hero-d',
      template: assembly.template,
    };
    const changes = await diffAgainstDeployed(request, () => Promise.resolve(toolkit));
    expect(changes.map((c) => c.action)).toEqual(['delete']);
    expect(calls).toEqual(['diff']);
    await expect(
      diffAgainstDeployed({ ...request, artifactHash: '0'.repeat(64) }, () =>
        Promise.resolve(toolkit),
      ),
    ).rejects.toThrow();
  });
});
