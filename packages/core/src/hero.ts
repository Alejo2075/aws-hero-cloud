import type { HeroSpec } from '@hero-cloud/specification';
import type { Approval, ApprovalChallenge } from './approval.js';
import type { HeroEventListener } from './events.js';
import type { DeploymentPlan, PlanRef } from './plan.js';
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
  readonly options?: readonly string[];
}

export interface Analysis {
  readonly spec: HeroSpec;
  readonly detections: readonly Detection[];
  readonly openQuestions: readonly OpenQuestion[];
  /** Whether an AI provider contributed. False for deterministic-only runs. */
  readonly aiAssisted: boolean;
}

export interface AnalyzeOptions {
  /** Deterministic analysis only; never contact an AI provider. */
  readonly noAi?: boolean;
}

export interface PlanOptions {
  readonly region?: string;
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
