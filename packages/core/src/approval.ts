import type { DeploymentPlan } from './plan.js';

/**
 * Proof that a person approved one specific plan. Deploying requires it; nothing else grants
 * permission to change infrastructure.
 *
 * Only an interface the user is looking at may create an approval: a terminal prompt, Studio, or
 * an MCP elicitation the person answers. An AI agent, script, or tool call never approves itself.
 */
export interface Approval {
  readonly planId: string;
  /** Must equal `DeploymentPlan.digest`. */
  readonly planDigest: string;
  /** The interface that collected the decision, e.g. `cli`, `studio`, `mcp`, `host-app`. */
  readonly channel: string;
  readonly approvedAt: string;
}

/** The host application supplies this. It decides how a human sees and accepts a plan. */
export interface ApprovalHandler {
  request(plan: DeploymentPlan): Promise<Approval | null>;
}
