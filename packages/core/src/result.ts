import type { CostEstimate, Rationale } from './plan.js';

export type EndpointKind = 'url' | 'ip' | 'hostname' | 'console' | 'ssh' | 'database' | 'other';

/** Where the application can be reached. */
export interface Endpoint {
  readonly kind: EndpointKind;
  readonly label: string;
  readonly value: string;
  readonly public: boolean;
}

export interface DeployedResource {
  readonly provider: string;
  readonly type: string;
  readonly name: string;
  readonly id: string;
}

/** Where a sensitive output can be found. The value itself is never part of a result. */
export interface SensitiveOutput {
  readonly name: string;
  readonly location: string;
}

/** What a person can be told to do next after a deployment. Words live in `presentation`. */
export const nextStepCodes = [
  'next.open-site',
  'next.check-health',
  'next.set-secrets',
  'next.watch-cost',
  'next.destroy',
  'next.review-kept-data',
  'next.use-deployer-role',
  'next.deploy-first-app',
] as const;

const REACHABILITY_FAILURES = [
  'timeout',
  'unreachable',
  'redirect-off-host',
  'redirect',
  'too-many-redirects',
  'server-error',
] as const;
const SMOKE_FAILURES = [
  'timeout',
  'unreachable',
  'redirect-off-host',
  'redirect',
  'too-many-redirects',
  'bad-status',
] as const;

/** Every code a health check can carry, including why a check failed. */
export const healthCheckCodes = [
  'health.resource-state',
  'health.targets',
  'health.targets.unhealthy',
  'health.targets.unavailable',
  'health.drift',
  'health.drift.drifted',
  'health.drift.unavailable',
  'health.reachability',
  ...REACHABILITY_FAILURES.map((reason) => `health.reachability.${reason}`),
  'health.smoke',
  ...SMOKE_FAILURES.map((reason) => `health.smoke.${reason}`),
] as const;

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/**
 * - `reachability`: Hero requested the endpoint from outside and looked at the answer.
 * - `resource-state`: the provider reports the resource as running, available, or in service.
 * - `smoke`: an optional request to a path the Hero Spec or the user named.
 * - `drift`: the provider compares the deployed resources with what Hero created.
 */
export type CheckKind = 'reachability' | 'resource-state' | 'smoke' | 'drift';

export interface HealthCheck {
  readonly id: string;
  /** The Hero Spec component this check covers: the frontend or a service, data, or storage id. */
  readonly component: string;
  readonly kind: CheckKind;
  readonly code: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly target?: string;
  readonly observed?: { readonly statusCode?: number; readonly latencyMs?: number };
}

export interface ComponentHealth {
  readonly component: string;
  readonly status: HealthStatus;
  /** Ids of the checks behind this status. */
  readonly checks: readonly string[];
}

/**
 * The evidence that the system is working, from what Hero can observe. It is repeatable: ask again
 * at any time with `Hero.health`. Hero never claims more than its checks show.
 */
export interface Health {
  readonly status: HealthStatus;
  readonly checkedAt: string;
  readonly components: readonly ComponentHealth[];
  readonly checks: readonly HealthCheck[];
}

/** A place to look at or operate the deployment, such as logs or the cost page. */
export interface OperationLink {
  readonly kind: 'console' | 'logs' | 'metrics' | 'dashboard' | 'cost';
  readonly label: string;
  readonly value: string;
}

/**
 * Everything a person needs after a deployment: how to reach the app, whether it works and what
 * was checked, what it costs, where to look, what to do next, and how to remove it. Interfaces
 * show as much of it as the reader's audience level calls for; the data is always complete.
 */
export interface DeploymentResult {
  readonly deploymentId: string;
  readonly planId: string;
  /** Absent for a deployment. `removal` is a destroy; `setup` is the preparation of an account. */
  readonly kind?: 'removal' | 'setup';
  readonly status: 'succeeded' | 'failed' | 'rolled-back' | 'partial';
  readonly endpoints: readonly Endpoint[];
  readonly health: Health;
  readonly resources: readonly DeployedResource[];
  readonly sensitiveOutputs: readonly SensitiveOutput[];
  readonly links: readonly OperationLink[];
  readonly cost?: CostEstimate;
  readonly nextSteps: readonly Rationale[];
  readonly completedAt: string;
}
