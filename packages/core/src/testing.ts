import { sha256Hex } from '@hero-cloud/shared';
import { sealPlan } from './digest.js';
import type { DeploymentPlan, PlanBody } from './plan.js';
import type { ProjectSnapshot, SkippedEntry, SnapshotFile } from './ports.js';
import { computeSnapshotHash } from './snapshot.js';

/** A minimal valid plan body, shared by tests across packages. */
export function samplePlanBody(overrides: Partial<PlanBody> = {}): PlanBody {
  return {
    specVersion: '1',
    strategy: 'static',
    target: { provider: 'aws', region: 'us-east-1', accountId: '123456789012' },
    changes: [
      {
        id: 'site',
        action: 'create',
        capability: 'web-frontend',
        resource: { provider: 'aws', type: 'cloudfront-distribution', name: 'site' },
        destructive: false,
        rationale: [{ code: 'frontend.static', evidence: ['package.json:vite'] }],
      },
    ],
    warnings: [],
    requiredInputs: [],
    artifactHash: 'a'.repeat(64),
    ...overrides,
  };
}

export function samplePlan(overrides: Partial<PlanBody> = {}): DeploymentPlan {
  return sealPlan(samplePlanBody(overrides));
}

/**
 * An in-memory project snapshot for tests. Files are given as a map of relative path to text.
 * Production code never imports this; it is exposed as `@hero-cloud/core/testing`.
 */
export function memorySnapshot(
  files: Readonly<Record<string, string>>,
  skipped: readonly SkippedEntry[] = [],
): ProjectSnapshot {
  const encoder = new TextEncoder();
  const bytes = new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
  const index: SnapshotFile[] = [...bytes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, content]) => ({ path, size: content.byteLength, sha256: sha256Hex(content) }));
  return {
    hash: computeSnapshotHash(index),
    files: index,
    skipped,
    read: (path) => {
      const content = bytes.get(path);
      return content === undefined
        ? Promise.reject(new Error(`not in snapshot: ${path}`))
        : Promise.resolve(content);
    },
    dispose: () => Promise.resolve(),
  };
}
