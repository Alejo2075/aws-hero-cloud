import type { HeroSpec } from '@hero-cloud/specification';
import type { Approval, ApprovalChallenge } from './approval.js';
import type { CallerIdentity, SetupReport } from './provider.js';
import type { HeroEventListener } from './events.js';
import type { DeploymentPlan, PlanRef } from './plan.js';
import type { SecretLocation, SkippedEntry } from './ports.js';
import type { DeploymentResult, Health } from './result.js';

export interface SourceRef {
  /** `directory`, `zip`, `git`, or a kind added by a source plugin. */
  readonly kind: string;
  readonly location: string;
}

export interface Detection {
  readonly capability: string;
  /** 0 to 1. */
  readonly confidence: number;
  readonly evidence: readonly string[];
}

/** Something Hero could not decide alone. Interfaces ask the person; agents relay the question. */
export interface OpenQuestion {
  readonly id: string;
  readonly code: string;
  readonly params?: Readonly<Record<string, string | number | boolean>>;
  readonly options?: readonly string[];
}

export interface Analysis {
  readonly spec: HeroSpec;
  /** Hash of the source snapshot that was analyzed. Later steps reload the source and compare it. */
  readonly sourceHash: string;
  readonly detections: readonly Detection[];
  readonly openQuestions: readonly OpenQuestion[];
  /** What the source loader left out (secrets, dependencies, symlinks). Paths only, never contents. */
  readonly skipped: readonly SkippedEntry[];
  /** Whether an AI provider contributed. False for deterministic-only runs. */
  readonly aiAssisted: boolean;
}

/**
 * What an application looked like when Hero could not put it online, so a person can choose to
 * share it. It holds structure and manifests only, redacted, and never leaves the machine unless
 * the person sends it themselves.
 */
export interface UnsupportedReport {
  readonly schema: 1;
  readonly application: string;
  readonly sourceHash: string;
  /** Why this report exists: nothing was recognized, a question stayed open, or it was asked for. */
  readonly reason: 'nothing-recognized' | 'open-questions' | 'requested';
  readonly detected: readonly { readonly capability: string; readonly confidence: number }[];
  readonly openQuestions: readonly string[];
  /** Paths only, without secrets, dependencies, or build output. Capped. */
  readonly files: readonly string[];
  /** The start of the files that say what an application is, such as `package.json`. */
  readonly manifests: Readonly<Record<string, string>>;
  readonly redactions: number;
}

export interface AnalyzeOptions {
  /** Deterministic analysis only; never contact an AI provider. */
  readonly noAi?: boolean;
  /** Analyze only this folder inside the source, for monorepos. Relative, no `..`. */
  readonly root?: string;
  /** Application name to use when the source does not name itself. */
  readonly name?: string;
  /**
   * A Hero Spec the user supplies from outside the source. It is validated and used as is,
   * skipping analysis. A `hero.yaml` found inside the source never takes this path.
   */
  readonly spec?: HeroSpec;
  readonly signal?: AbortSignal;
}

export interface DeployOptions {
  /**
   * Secret values by name, for the secrets the plan asked for. They go straight to the user's own
   * secret store and are never kept, logged, or returned. Doors collect them without echoing.
   */
  readonly secrets?: Readonly<Record<string, string>>;
  /**
   * Values the plan asked for that are settings rather than secrets, by name, such as the email
   * address for spending alerts. Secret values never travel through here.
   */
  readonly inputs?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface PlanOptions {
  readonly region?: string;
  /**
   * The AWS account the plan is for. Normally the engine asks the provider who you are; without
   * an account the plan is a preview and carries a blocking warning, so it cannot be approved.
   */
  readonly accountId?: string;
  /** Names the deployment. Defaults to the application name. */
  readonly name?: string;
  /**
   * Asks the cloud who the credentials belong to and plans for that account. Ignored when
   * `accountId` is given. Fails with `identity.root-refused` for the account owner.
   */
  readonly useIdentity?: boolean;
  /** Never contact the network, not even for public prices. */
  readonly offline?: boolean;
  /** Answers to `Analysis.openQuestions`, keyed by question id. */
  readonly answers?: Readonly<Record<string, string>>;
}

/**
 * The one door into Hero. The CLI, Studio, the local server, the MCP server, IDE extensions, and
 * third-party products are all adapters over this interface. None of them reaches past it.
 */
export interface Hero {
  analyze(source: SourceRef, options?: AnalyzeOptions): Promise<Analysis>;
  plan(analysis: Analysis, options?: PlanOptions): Promise<DeploymentPlan>;
  /**
   * Describes an application Hero could not handle, in a form safe to share: structure and
   * manifests, redacted. Nothing is sent anywhere; the person decides what to do with it.
   */
  report(source: SourceRef, options?: AnalyzeOptions): Promise<UnsupportedReport>;
  /** Where the person stands on the way to a first deployment. Reads only. */
  inspectSetup(options?: {
    readonly region?: string;
    readonly profile?: string;
  }): Promise<SetupReport>;
  /**
   * The plan that prepares an account for Hero: a permission boundary, limited deployment
   * permissions in place of administrator access, and a deployer role. It needs approval like any
   * other plan.
   */
  planBootstrap(options?: { readonly region?: string }): Promise<DeploymentPlan>;
  /** Who the configured cloud credentials belong to. Refuses the account owner. */
  identity(options?: { readonly region?: string }): Promise<CallerIdentity>;
  /**
   * Issues a one-time challenge for a plan this engine produced. Give it only to the door that
   * shows the plan to a person; never to an AI agent.
   */
  requestApproval(plan: PlanRef): Promise<ApprovalChallenge>;
  /**
   * Applies exactly the approved plan. The engine resolves the plan from its own store, so a plan
   * it did not produce is refused, and the approval must match the plan's digest, account, and
   * region and be unexpired and unused.
   */
  deploy(plan: PlanRef, approval: Approval, options?: DeployOptions): Promise<DeploymentResult>;
  /** A plan whose changes are all deletions. It needs approval like any other plan. */
  planDestroy(deploymentId: string): Promise<DeploymentPlan>;
  /** The result of an existing deployment: endpoints, links, cost, and the latest health. */
  outputs(deploymentId: string): Promise<DeploymentResult>;
  /** Runs the health checks again and returns fresh evidence that the system is working. */
  health(deploymentId: string): Promise<Health>;
  /**
   * Stores one secret of an existing deployment in the user's own secret store. The name must be
   * one the deployed plan asked for. The value is not kept, logged, or returned.
   */
  setSecret(deploymentId: string, name: string, value: string): Promise<SecretLocation>;
  subscribe(listener: HeroEventListener): () => void;
}
