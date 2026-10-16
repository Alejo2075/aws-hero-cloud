/** What a Hero deployment can look like, from least to most operational burden. */
export type DeploymentStrategy = 'static' | 'serverless' | 'container' | 'virtual-machine';

export type ChangeAction = 'create' | 'update' | 'replace' | 'delete';

/**
 * A machine-readable reason. Human wording lives in `@hero-cloud/presentation`, so one reason can
 * be explained at every audience level and in every locale.
 */
export interface Rationale {
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  /** References to analyzer evidence that justify this reason. */
  readonly evidence?: readonly string[];
}

export interface PlanChange {
  readonly id: string;
  readonly action: ChangeAction;
  /** The provider-neutral need this change satisfies, e.g. `web-frontend` or `relational-data`. */
  readonly capability: string;
  readonly resource: {
    readonly provider: string;
    readonly type: string;
    readonly name: string;
  };
  /** True for `delete`, `replace`, and any update that can lose data. */
  readonly destructive: boolean;
  readonly rationale: readonly Rationale[];
  /** Provider-specific detail, shown at the expert level only. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PlanWarning {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'blocking';
  readonly changeId?: string;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
}

export interface CostEstimate {
  readonly currency: 'USD';
  readonly monthlyLow: number;
  readonly monthlyHigh: number;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly assumptions: readonly string[];
}

/** Something the user must supply before deploying. Values are never stored in the plan. */
export interface RequiredInput {
  readonly name: string;
  readonly kind: 'secret' | 'config';
  readonly reason: Rationale;
}

export interface DeploymentTarget {
  readonly provider: string;
  readonly region: string;
  /** The account the plan was made for. A plan cannot be approved for any other account. */
  readonly accountId: string;
}

/** Everything in a plan except what is derived from it. */
export interface PlanBody {
  readonly specVersion: string;
  readonly strategy: DeploymentStrategy;
  readonly target: DeploymentTarget;
  readonly changes: readonly PlanChange[];
  readonly warnings: readonly PlanWarning[];
  readonly requiredInputs: readonly RequiredInput[];
  readonly cost?: CostEstimate;
  /**
   * Hash of what the provider will actually apply, such as the synthesized cloud assembly. It is
   * part of the digest, so approving a plan approves exactly those artifacts (D1).
   */
  readonly artifactHash: string;
}

/**
 * A sealed plan. `digest` is the SHA-256 of the canonical JSON of the body; `id` is derived from
 * it. Neither can be chosen by a caller: only `sealPlan` produces them.
 */
export interface DeploymentPlan extends PlanBody {
  readonly id: string;
  readonly digest: string;
}

/** What a door needs to name a plan. The engine resolves the real plan from its own store. */
export type PlanRef = Pick<DeploymentPlan, 'id' | 'digest'>;
