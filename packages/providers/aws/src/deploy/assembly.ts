import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heroError } from '@hero-cloud/core';
import { hashAssembly } from '../cdk/synth.js';
import type { CfnTemplate } from '../cdk/synth.js';

export interface StoredAssembly {
  readonly directory: string;
  readonly stackName: string;
}

interface Manifest {
  readonly artifacts?: Readonly<
    Record<string, { readonly type?: string; readonly environment?: string }>
  >;
}

/**
 * Checks that a stored cloud assembly is exactly the one that was approved: one stack, for this
 * account and region, whose contents hash to the plan's `artifactHash`. Nothing is synthesized
 * again, so a changed file, a swapped template, or a different environment is refused.
 */
export function verifyAssembly(
  directory: string,
  expected: { readonly hash: string; readonly accountId: string; readonly region: string },
): StoredAssembly {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as Manifest;
  } catch (error) {
    throw heroError('approval.plan-mismatch', { reason: 'assembly-unreadable' }, error);
  }
  const stacks = Object.entries(manifest.artifacts ?? {}).filter(
    ([, artifact]) => artifact.type === 'aws:cloudformation:stack',
  );
  const only = stacks[0];
  if (stacks.length !== 1 || only === undefined) {
    throw heroError('approval.plan-mismatch', { reason: 'assembly-stack-count' });
  }
  const [stackName, artifact] = only;
  if (artifact.environment !== `aws://${expected.accountId}/${expected.region}`) {
    throw heroError('approval.plan-mismatch', { reason: 'assembly-environment' });
  }
  let template: CfnTemplate;
  try {
    template = JSON.parse(
      readFileSync(join(directory, `${stackName}.template.json`), 'utf8'),
    ) as CfnTemplate;
  } catch (error) {
    throw heroError('approval.plan-mismatch', { reason: 'assembly-unreadable' }, error);
  }
  const actual = hashAssembly(stackName, template, expected.accountId, expected.region);
  if (actual !== expected.hash) {
    throw heroError('approval.plan-mismatch', { reason: 'assembly-hash' });
  }
  return { directory, stackName };
}
