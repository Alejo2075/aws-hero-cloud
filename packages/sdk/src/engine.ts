import { basename } from 'node:path';
import { analyzeSnapshot, toApplicationName } from '@hero-cloud/analyzer';
import { ApprovalService, InMemoryPlanStore, heroError, isSealIntact } from '@hero-cloud/core';
import type {
  Analysis,
  AnalyzeOptions,
  Approval,
  ApprovalChallenge,
  ChallengeStore,
  DeploymentPlan,
  DeploymentResult,
  Health,
  Hero,
  HeroEvent,
  HeroEventListener,
  HeroPhase,
  HeroPorts,
  PlanOptions,
  PlanRef,
  SourceLoader,
  SourceRef,
} from '@hero-cloud/core';
import { nodePlugin } from '@hero-cloud/plugin-node';
import type { DetectorPlugin } from '@hero-cloud/plugin-sdk';
import { validateHeroSpec } from '@hero-cloud/specification';
import { DirectorySource, GitSource, ZipSource } from '@hero-cloud/sources';
import type { SourceLimits } from '@hero-cloud/sources';

export interface CreateHeroOptions extends HeroPorts {
  /** Detectors to run. Defaults to the official Node plugin. */
  readonly detectors?: readonly DetectorPlugin[];
  readonly limits?: SourceLimits;
  readonly challenges?: ChallengeStore;
  /** How long an approval challenge stays valid, in milliseconds. */
  readonly approvalTtlMs?: number;
  readonly clock?: { now(): Date };
}

/** The engine behind the `Hero` interface. Create it with `createHero`. */
class HeroEngine implements Hero {
  readonly #loaders: ReadonlyMap<string, SourceLoader>;
  readonly #detectors: readonly DetectorPlugin[];
  readonly #plans;
  readonly #approvals: ApprovalService;
  readonly #listeners = new Set<HeroEventListener>();
  readonly #clock: { now(): Date };

  constructor(options: CreateHeroOptions) {
    const defaults: SourceLoader[] = [
      new DirectorySource(options.limits),
      new ZipSource(options.limits === undefined ? {} : { limits: options.limits }),
      new GitSource(options.limits === undefined ? {} : { limits: options.limits }),
    ];
    this.#loaders = new Map(
      [...defaults, ...(options.sources ?? [])].map((loader) => [loader.kind, loader]),
    );
    this.#detectors = options.detectors ?? nodePlugin.detectors;
    this.#plans = options.plans ?? new InMemoryPlanStore();
    this.#clock = options.clock ?? { now: () => new Date() };
    this.#approvals = new ApprovalService({
      ...(options.challenges === undefined ? {} : { store: options.challenges }),
      ...(options.approvalTtlMs === undefined ? {} : { ttlMs: options.approvalTtlMs }),
      clock: this.#clock,
    });
  }

  subscribe(listener: HeroEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(event: HeroEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // A faulty listener must never break the engine.
      }
    }
  }

  async #phase<T>(phase: HeroPhase, work: () => Promise<T>): Promise<T> {
    const at = (): string => this.#clock.now().toISOString();
    this.#emit({ type: 'phase', phase, status: 'started', at: at() });
    try {
      const result = await work();
      this.#emit({ type: 'phase', phase, status: 'completed', at: at() });
      return result;
    } catch (error) {
      this.#emit({ type: 'phase', phase, status: 'failed', at: at() });
      throw error;
    }
  }

  async analyze(source: SourceRef, options: AnalyzeOptions = {}): Promise<Analysis> {
    const loader = this.#loaders.get(source.kind);
    if (loader === undefined) throw heroError('source.unsupported', { kind: source.kind });

    const snapshot = await this.#phase('load', () =>
      loader.load(source, options.signal === undefined ? {} : { signal: options.signal }),
    );
    try {
      return await this.#phase('analyze', async () => {
        const name =
          options.name ??
          toApplicationName(basename(source.location.replace(/#.*$/, '').replace(/\.git$/, '')));
        if (options.spec !== undefined) {
          // A spec the user supplied from outside the source is trusted, but still validated.
          const checked = validateHeroSpec(options.spec);
          if (!checked.ok) {
            throw heroError('spec.invalid', {
              issues: checked.issues.map((i) => `${i.path}:${i.code}`).join(','),
            });
          }
          return {
            spec: checked.spec,
            sourceHash: snapshot.hash,
            detections: [],
            openQuestions: [],
            skipped: snapshot.skipped,
            aiAssisted: false,
          };
        }
        return analyzeSnapshot(snapshot, {
          detectors: this.#detectors,
          name,
          ...(options.root === undefined ? {} : { root: options.root }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      });
    } finally {
      await snapshot.dispose();
    }
  }

  plan(_analysis: Analysis, _options?: PlanOptions): Promise<DeploymentPlan> {
    return Promise.reject(heroError('internal.not-implemented', { operation: 'plan' }));
  }

  /** Finds a plan this engine produced. Anything else, or a plan altered since sealing, is refused. */
  async #resolvePlan(ref: PlanRef): Promise<DeploymentPlan> {
    const stored = await this.#plans.get(ref.id);
    if (stored === undefined) throw heroError('plan.unknown');
    if (stored.digest !== ref.digest || !isSealIntact(stored)) throw heroError('plan.tampered');
    return stored;
  }

  async requestApproval(plan: PlanRef): Promise<ApprovalChallenge> {
    return this.#approvals.issue(await this.#resolvePlan(plan));
  }

  deploy(_plan: PlanRef, _approval: Approval): Promise<DeploymentResult> {
    return Promise.reject(heroError('internal.not-implemented', { operation: 'deploy' }));
  }

  planDestroy(_deploymentId: string): Promise<DeploymentPlan> {
    return Promise.reject(heroError('internal.not-implemented', { operation: 'planDestroy' }));
  }

  outputs(_deploymentId: string): Promise<DeploymentResult> {
    return Promise.reject(heroError('internal.not-implemented', { operation: 'outputs' }));
  }

  health(_deploymentId: string): Promise<Health> {
    return Promise.reject(heroError('internal.not-implemented', { operation: 'health' }));
  }
}

/**
 * Creates an engine. Every dependency is a port you can replace; the defaults read local folders,
 * ZIP files, and Git repositories, keep plans in memory, and never contact a Hero service.
 */
export function createHero(options: CreateHeroOptions = {}): Hero {
  return new HeroEngine(options);
}
