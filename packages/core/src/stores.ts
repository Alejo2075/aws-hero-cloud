import type { DeploymentPlan } from './plan.js';
import type { PlanStore, StateStore } from './ports.js';

/** Keeps plans in memory. The default `PlanStore` for embedded use and for tests. */
export class InMemoryPlanStore implements PlanStore {
  readonly #plans = new Map<string, DeploymentPlan>();

  put(plan: DeploymentPlan): Promise<void> {
    this.#plans.set(plan.id, plan);
    return Promise.resolve();
  }

  get(planId: string): Promise<DeploymentPlan | undefined> {
    return Promise.resolve(this.#plans.get(planId));
  }
}

/** Keeps deployment state in memory. The default `StateStore` when a host provides none. */
export class InMemoryStateStore implements StateStore {
  readonly #state = new Map<string, unknown>();

  read(deploymentId: string): Promise<unknown> {
    return Promise.resolve(this.#state.get(deploymentId));
  }

  write(deploymentId: string, state: unknown): Promise<void> {
    this.#state.set(deploymentId, state);
    return Promise.resolve();
  }

  list(): Promise<readonly string[]> {
    return Promise.resolve([...this.#state.keys()]);
  }
}
