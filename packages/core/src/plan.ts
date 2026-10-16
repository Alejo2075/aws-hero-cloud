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

/** One item in a cost estimate, such as API requests or database reads. */
export interface CostLine {
  /** Names the item; its words live in `presentation` under `cost.line.<code>`. */
  readonly code: string;
  readonly monthlyLow: number;
  readonly monthlyHigh: number;
}

/**
 * A monthly cost range, never a single promise. `monthlyLow` is a nearly idle application and
 * `monthlyHigh` a busy small one; the assumptions behind both are listed as codes with parameters.
 */
export interface CostEstimate {
  readonly currency: 'USD';
  readonly monthlyLow: number;
  readonly monthlyHigh: number;
  /** Usage is always a guess, so this is `medium` at best, and `low` when prices were not fresh. */
  readonly confidence: 'low' | 'medium' | 'high';
  readonly lines: readonly CostLine[];
  readonly assumptions: readonly Rationale[];
  /** Where unit prices came from: fetched now, cached, or built into Hero. */
  readonly priceSource: 'live' | 'cache' | 'built-in';
  /** The date the prices were published, as `YYYY-MM-DD`. */
  readonly pricesAsOf: string;
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
  /** The application's name, so every view of the plan can say what it is for. */
  readonly application: string;
  readonly specVersion: string;
  /**
   * Hash of the source snapshot that was analyzed. Anything built later must come from a source
   * with this same hash, so what is approved is what was reviewed.
   */
  readonly sourceHash: string;
  readonly strategy: DeploymentStrategy;
  /** Why this strategy and not a lower one, so every audience level can explain the choice. */
  readonly strategyRationale: readonly Rationale[];
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
  /**
   * Absent for a deployment. `destroy` marks a plan whose changes are all removals; it needs
   * approval like any other plan, and `deploymentId` names what it removes.
   */
  readonly intent?: 'destroy';
  readonly deploymentId?: string;
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

/**
 * Warning codes the planner and providers can raise. Each has a message at every audience level
 * under `warning.<code>`. A `blocking` warning stops a plan from being approved or deployed.
 */
export const planWarningCodes = [
  'plan.account-unverified',
  'plan.open-question',
  'plan.unsupported-capability',
  'plan.public-exposure',
  'plan.cost-low-confidence',
  'plan.ssr-cold-start',
  'plan.scheduled-inside-server',
  'plan.secrets-required',
  'plan.nothing-to-deploy',
  'plan.unsupported-schedule',
  'plan.destroy-keeps-data',
] as const;

export type PlanWarningCode = (typeof planWarningCodes)[number];
