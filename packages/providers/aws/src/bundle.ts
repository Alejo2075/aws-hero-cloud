import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { heroError } from '@hero-cloud/core';
import { canonicalJson, sha256Hex } from '@hero-cloud/shared';
import type { BuildPlan } from './build/plan.js';
import { verifyAssembly } from './deploy/assembly.js';

/**
 * Everything a plan will apply: the application stack, the stack that builds it (when something
 * needs building), and the exact build commands. The plan's `artifactHash` covers all of it, so
 * approving the plan approves each part.
 */
export interface BundleParts {
  readonly appHash: string;
  readonly buildHash: string | undefined;
  readonly buildPlan: BuildPlan;
}

/** Drops `undefined` fields the way JSON does, so a plan hashes the same before and after storage. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function bundleHash(parts: BundleParts): string {
  return sha256Hex(
    canonicalJson({
      app: parts.appHash,
      build: parts.buildHash ?? null,
      plan: plain(parts.buildPlan),
    }),
  );
}

export interface BundleSource extends BundleParts {
  readonly appDirectory: string;
  readonly buildDirectory: string | undefined;
}

/** Keeps a copy of the assemblies and the build plan under the bundle's hash. */
export function storeBundle(root: string, source: BundleSource): string {
  const hash = bundleHash(source);
  const target = join(root, hash);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source.appDirectory, join(target, 'app'), { recursive: true });
  if (source.buildDirectory !== undefined) {
    cpSync(source.buildDirectory, join(target, 'build'), { recursive: true });
  }
  const parts: BundleParts = {
    appHash: source.appHash,
    buildHash: source.buildHash,
    buildPlan: source.buildPlan,
  };
  writeFileSync(join(target, 'bundle.json'), canonicalJson(plain(parts)));
  return target;
}

export interface LoadedBundle {
  readonly appHash: string;
  readonly buildHash: string | undefined;
  readonly appDirectory: string;
  readonly buildDirectory: string | undefined;
  readonly buildPlan: BuildPlan;
}

/**
 * Loads a stored bundle and proves each part is what was approved: the recorded parts hash to the
 * plan's `artifactHash`, and each assembly hashes to its recorded hash for this account and region.
 */
export function loadBundle(
  root: string,
  artifactHash: string,
  environment: { readonly accountId: string; readonly region: string },
): LoadedBundle {
  if (!/^[0-9a-f]{64}$/.test(artifactHash)) {
    throw heroError('approval.plan-mismatch', { reason: 'bundle-hash' });
  }
  const directory = join(root, artifactHash);
  let parts: BundleParts;
  try {
    parts = JSON.parse(readFileSync(join(directory, 'bundle.json'), 'utf8')) as BundleParts;
  } catch (error) {
    throw heroError('approval.plan-mismatch', { reason: 'bundle-unreadable' }, error);
  }
  if (bundleHash(parts) !== artifactHash) {
    throw heroError('approval.plan-mismatch', { reason: 'bundle-hash' });
  }
  const appDirectory = join(directory, 'app');
  verifyAssembly(appDirectory, { hash: parts.appHash, ...environment });
  let buildDirectory: string | undefined;
  if (parts.buildHash !== undefined) {
    buildDirectory = join(directory, 'build');
    verifyAssembly(buildDirectory, { hash: parts.buildHash, ...environment });
  }
  return {
    appHash: parts.appHash,
    buildHash: parts.buildHash,
    appDirectory,
    buildDirectory,
    buildPlan: parts.buildPlan,
  };
}
