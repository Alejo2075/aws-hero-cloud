import type { Detection, OpenQuestion, SnapshotFile } from '@hero-cloud/core';
import type { DataSpec, FrontendSpec, ServiceSpec, StorageSpec } from '@hero-cloud/specification';

/**
 * The public contract for teaching Hero about a framework, runtime, or legacy stack. A detector
 * reads a read-only view of the project and reports what it needs, with evidence. It never
 * executes the project and never names cloud resources.
 */

/**
 * The provider-neutral vocabulary of things an application can need. Detectors report these names,
 * the planner reads them, and every one has a message at each audience level. Adding one means
 * adding its messages in the same change.
 */
export const standardCapabilities = [
  'web-frontend',
  'http-service',
  'scheduled-job',
  'process-service',
  'relational-data',
  'key-value-data',
  'document-data',
  'cache',
  'search',
  'object-storage',
  'file-uploads',
  'file-system-write',
  'authentication',
  'environment-variables',
  'node-runtime',
  'monorepo',
  'declared-spec',
  'cost-control',
  'account-setup',
] as const;

export type StandardCapability = (typeof standardCapabilities)[number];

/** The kinds of reference an evidence string can start with, as in `dependency:express`. */
export const evidenceKinds = [
  'dependency',
  'file',
  'script',
  'field',
  'config',
  'source',
  'absent',
  'default',
  'capability',
] as const;

export type EvidenceKind = (typeof evidenceKinds)[number];

/** Splits an evidence string such as `dependency:express@^5` into its kind and value. */
export function parseEvidence(evidence: string): { kind: string; value: string } {
  const index = evidence.indexOf(':');
  return index === -1
    ? { kind: 'unknown', value: evidence }
    : { kind: evidence.slice(0, index), value: evidence.slice(index + 1) };
}

/** A read-only view of the project handed to every detector. */
export interface DetectionContext {
  /** Every file in scope, sorted by path. Paths are relative and use `/`. */
  readonly files: readonly SnapshotFile[];
  has(path: string): boolean;
  /** Paths that start with `prefix` (a folder, with or without a trailing `/`). Empty prefix lists all. */
  list(prefix?: string): readonly string[];
  /**
   * File text, or `undefined` when the file is missing, unreadable, or larger than `maxBytes`
   * (default 512 KiB). Never throws for ordinary missing files.
   */
  readText(path: string, maxBytes?: number): Promise<string | undefined>;
  /** Parsed JSON, or `undefined` when the file is missing or is not valid JSON. */
  readJson(path: string): Promise<unknown>;
}

/** One piece of the Hero Spec that a detector is confident about. */
export type Contribution =
  | { readonly kind: 'name'; readonly value: string; readonly confidence: number }
  | { readonly kind: 'frontend'; readonly value: FrontendSpec; readonly confidence: number }
  | { readonly kind: 'service'; readonly value: ServiceSpec; readonly confidence: number }
  | { readonly kind: 'data'; readonly value: DataSpec; readonly confidence: number }
  | { readonly kind: 'storage'; readonly value: StorageSpec; readonly confidence: number }
  | { readonly kind: 'auth'; readonly required: boolean; readonly confidence: number }
  | { readonly kind: 'environment'; readonly names: readonly string[] }
  | { readonly kind: 'extension'; readonly key: `x-${string}`; readonly value: unknown };

/**
 * What a detector found. Evidence strings are short references such as `dependency:express` or
 * `file:vite.config.ts`. They name where something was seen; they never copy file contents.
 */
export interface Finding {
  readonly detections: readonly Detection[];
  readonly contributions: readonly Contribution[];
  readonly questions: readonly OpenQuestion[];
}

export const emptyFinding: Finding = { detections: [], contributions: [], questions: [] };

export interface DetectorPlugin {
  /** Stable identifier, e.g. `node/express`. */
  readonly id: string;
  readonly description?: string;
  detect(context: DetectionContext): Promise<Finding>;
}

/** Identity helper that gives detector authors type checking and completion. */
export function defineDetector(detector: DetectorPlugin): DetectorPlugin {
  return detector;
}

/** A plugin bundles detectors. More extension points are added as they are needed. */
export interface HeroPlugin {
  readonly id: string;
  readonly detectors: readonly DetectorPlugin[];
}

export function definePlugin(plugin: HeroPlugin): HeroPlugin {
  return plugin;
}
