import type { HeroSpec } from '@hero-cloud/specification';
import type { Approval, ApprovalChallenge } from './approval.js';
import type { HeroEventListener } from './events.js';
import type { DeploymentPlan, PlanRef } from './plan.js';
import type { SkippedEntry } from './ports.js';
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

export interface PlanOptions {
  readonly region?: string;
  /**
   * The AWS account the plan is for. Normally the engine asks the provider who you are; without
   * an account the plan is a preview and carries a blocking warning, so it cannot be approved.
   */
  readonly accountId?: string;
  /** Names the deployment. Defaults to the application name. */
  readonly name?: string;
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
   * Issues a one-time challenge for a plan this engine produced. Give it only to the door that
   * shows the plan to a person; never to an AI agent.
   */
  requestApproval(plan: PlanRef): Promise<ApprovalChallenge>;
  /**
   * Applies exactly the approved plan. The engine resolves the plan from its own store, so a plan
   * it did not produce is refused, and the approval must match the plan's digest, account, and
   * region and be unexpired and unused.
   */
  deploy(plan: PlanRef, approval: Approval): Promise<DeploymentResult>;
  /** A plan whose changes are all deletions. It needs approval like any other plan. */
  planDestroy(deploymentId: string): Promise<DeploymentPlan>;
  /** The result of an existing deployment: endpoints, links, cost, and the latest health. */
  outputs(deploymentId: string): Promise<DeploymentResult>;
  /** Runs the health checks again and returns fresh evidence that the system is working. */
  health(deploymentId: string): Promise<Health>;
  subscribe(listener: HeroEventListener): () => void;
}
