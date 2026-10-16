import type {
  CostEstimate,
  DeploymentStrategy,
  PlanChange,
  PlanWarning,
  Rationale,
} from './plan.js';

/**
 * What the planner decides, in terms of needs rather than cloud resources. A provider turns these
 * into its own resources. This is the contract between the planner and any cloud provider.
 */
export type ComponentKind =
  | 'static-site'
  | 'http-service'
  | 'scheduled-job'
  | 'key-value-table'
  | 'object-bucket'
  | 'identity'
  | 'budget-alert';

export interface Component {
  /** Stable within a plan. Usually the Hero Spec id it comes from, such as `api` or `kv`. */
  readonly id: string;
  readonly kind: ComponentKind;
  /** The provider-neutral need this satisfies, such as `web-frontend` or `http-service`. */
  readonly capability: string;
  readonly settings: Readonly<Record<string, string | number | boolean>>;
  readonly rationale: readonly Rationale[];
}

export interface ProviderPlanRequest {
  readonly strategy: DeploymentStrategy;
  readonly components: readonly Component[];
  readonly region: string;
  readonly accountId: string;
  /** Names the deployment. Resources are tagged with it so they can be found and removed. */
  readonly deploymentId: string;
  /** Names the application needs from the person (settings and secrets), so the provider can plan a place for them. */
  readonly inputs: readonly { readonly name: string; readonly kind: 'secret' | 'config' }[];
  /** Allows live price lookups. When false the provider uses only built-in prices. */
  readonly allowNetwork: boolean;
}

export interface ProviderPlanResult {
  readonly changes: readonly PlanChange[];
  readonly warnings: readonly PlanWarning[];
  readonly cost: CostEstimate;
  /** Hash of what the provider will apply. See `PlanBody.artifactHash`. */
  readonly artifactHash: string;
}

/** Who the credentials in use belong to, as the cloud reports it. Never holds a key or token. */
export interface CallerIdentity {
  /** The cloud account the credentials act in. */
  readonly account: string;
  /** The cloud's name for the principal, such as an ARN. */
  readonly principal: string;
  readonly kind: 'user' | 'role' | 'federated' | 'other';
}

/**
 * A cloud the engine can plan for. Phase by phase it gains more operations (identity, deploy,
 * health, destroy); planning is what the planner needs today.
 */
export interface CloudProvider {
  readonly id: string;
  describe(request: ProviderPlanRequest): Promise<ProviderPlanResult>;
  /**
   * Asks the cloud who the configured credentials belong to. Throws `identity.root-refused` for
   * the account owner and `identity.unknown` when the credentials cannot be verified.
   */
  identity?(options?: { readonly region?: string }): Promise<CallerIdentity>;
}
