import type { Rationale } from './plan.js';

/**
 * Ports are the things a host replaces to embed the engine: where state lives, which AI is used,
 * how events are logged, and who approves. The engine has no console output, prompts, global
 * state, or hidden environment access; everything it touches arrives through a port.
 *
 * Source loading and the cloud provider are ports too. Their contracts are defined together with
 * the `sources` and `deployment` packages.
 */

/** Persists deployment state wherever the host wants: the local disk, a database, memory. */
export interface StateStore {
  read(deploymentId: string): Promise<unknown | undefined>;
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
  readonly ai?: AIProvider;
  readonly state?: StateStore;
  readonly logger?: Logger;
}
