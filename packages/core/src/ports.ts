import type { SourceRef } from './hero.js';
import type { CloudProvider } from './provider.js';
import type { DeploymentPlan, Rationale } from './plan.js';

/**
 * Ports are the things a host replaces to embed the engine: where state lives, which AI is used,
 * how events are logged, and who approves. The engine has no console output, prompts, global
 * state, or hidden environment access; everything it touches arrives through a port.
 *
 * The cloud provider and the build runner are ports too; their contracts arrive with the packages
 * that implement them (phases 5 to 7), because their shape depends on the planner.
 */

/** Persists deployment state wherever the host wants: the local disk, a database, memory. */
export interface StateStore {
  /** Resolves to `undefined` when nothing is stored for this deployment. */
  read(deploymentId: string): Promise<unknown>;
  write(deploymentId: string, state: unknown): Promise<void>;
  list(): Promise<readonly string[]>;
}

export interface AIRequest {
  /** What the model is asked to do, e.g. `interpret-legacy-service`. */
  readonly task: string;
  /** Already minimized and redacted by the engine. */
  readonly context: unknown;
  /** JSON Schema that the answer must satisfy. */
  readonly schema: Readonly<Record<string, unknown>>;
}

/** A user-supplied model. The engine validates every answer against `AIRequest.schema`. */
export interface AIProvider {
  generate<T>(request: AIRequest): Promise<T>;
}

/** Structured diagnostics. Entries carry codes and parameters, never secrets or source text. */
export interface Logger {
  debug(entry: Rationale): void;
  info(entry: Rationale): void;
  warn(entry: Rationale): void;
  error(entry: Rationale): void;
}

/**
 * Everything a host can supply to `createHero`. All are optional; the engine documents its
 * defaults, none of which contact a Hero service.
 */
export interface HeroPorts {
  readonly cloud?: CloudProvider;
  readonly ai?: AIProvider;
  readonly state?: StateStore;
  readonly logger?: Logger;
  readonly plans?: PlanStore;
  readonly secrets?: SecretSink;
  readonly sources?: readonly SourceLoader[];
}

/** One file in a snapshot. Paths are relative, use `/`, and never escape the root. */
export interface SnapshotFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

/**
 * A read-only view of a project's files, however it was loaded. Folder, ZIP, and Git sources of
 * the same content have the same `hash`. Analysis and builds consume snapshots, never the origin.
 */
export interface ProjectSnapshot {
  /** Hash of the sorted file index (path, size, sha256), see `computeSnapshotHash`. */
  readonly hash: string;
  readonly files: readonly SnapshotFile[];
  /** What the loader left out on purpose, and why. It never includes file contents. */
  readonly skipped: readonly SkippedEntry[];
  read(path: string): Promise<Uint8Array>;
  /** Releases temporary files. Safe to call more than once. */
  dispose(): Promise<void>;
}

export interface SkippedEntry {
  readonly path: string;
  /** `symlink`: never followed. `sensitive`: looks like a secret. `ignored`: build output or dependencies. `special`: a device, socket, or pipe. */
  readonly reason: 'symlink' | 'sensitive' | 'ignored' | 'special';
}

export interface LoadOptions {
  readonly signal?: AbortSignal;
}

/** Loads untrusted input into a snapshot. Implementations must never execute project code. */
export interface SourceLoader {
  readonly kind: string;
  load(ref: SourceRef, options?: LoadOptions): Promise<ProjectSnapshot>;
}

/** Remembers the plans this engine produced, so it can refuse plans it did not make (D2). */
export interface PlanStore {
  put(plan: DeploymentPlan): Promise<void>;
  get(planId: string): Promise<DeploymentPlan | undefined>;
}

export interface SecretLocation {
  readonly name: string;
  /** Where the value lives in the user's account, e.g. an SSM parameter name. Never the value. */
  readonly location: string;
}

/** Stores a secret value straight into the user's secret store. The value is never returned. */
export interface SecretSink {
  put(request: {
    readonly deploymentId: string;
    readonly name: string;
    readonly value: string;
  }): Promise<SecretLocation>;
}
