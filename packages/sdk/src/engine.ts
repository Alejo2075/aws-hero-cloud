import { basename } from 'node:path';
import { analyzeSnapshot, toApplicationName } from '@hero-cloud/analyzer';
import {
  ApprovalService,
  InMemoryPlanStore,
  heroError,
  isSealIntact,
  sealPlan,
} from '@hero-cloud/core';
import type {
  Analysis,
  AnalyzeOptions,
  Approval,
  ApprovalChallenge,
  CallerIdentity,
  ChallengeStore,
  CloudProvider,
  DeploymentPlan,
  DeploymentResult,
  Health,
  Hero,
  HeroEvent,
  HeroEventListener,
  HeroPhase,
  HeroPorts,
  PlanBody,
  PlanOptions,
  PlanRef,
  PlanWarning,
  SourceLoader,
  SourceRef,
} from '@hero-cloud/core';
import { nodePlugin } from '@hero-cloud/plugin-node';
import { BUDGET_EMAIL_INPUT, planApplication } from '@hero-cloud/planner';
import { createAwsProvider } from '@hero-cloud/provider-aws';
import type { DetectorPlugin } from '@hero-cloud/plugin-sdk';
import { sha256Hex } from '@hero-cloud/shared';
import { validateHeroSpec } from '@hero-cloud/specification';
import { DirectorySource, GitSource, ZipSource } from '@hero-cloud/sources';
import type { SourceLimits } from '@hero-cloud/sources';

export interface CreateHeroOptions extends HeroPorts {
  /** Detectors to run. Defaults to the official Node plugin. */
  readonly detectors?: readonly DetectorPlugin[];
  readonly limits?: SourceLimits;
  readonly challenges?: ChallengeStore;
  /** Where downloaded public prices are cached. Without one, prices are fetched each time. */
  readonly cacheDirectory?: string;
  /** A named AWS profile for credentials. Without one the standard AWS chain is used. */
  readonly awsProfile?: string;
  /** How long an approval challenge stays valid, in milliseconds. */
  readonly approvalTtlMs?: number;
  readonly clock?: { now(): Date };
}

const DEFAULT_REGION = 'us-east-1';
const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d$/;
const ACCOUNT_ID = /^\d{12}$/;
const UNVERIFIED_ACCOUNT = '000000000000';
const EMPTY_ARTIFACT_HASH = sha256Hex('nothing-to-apply');

/** `hero-` plus the application name, lowercased and made safe for use in resource names. */
export function deploymentIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `hero-${slug === '' ? 'app' : slug}`;
}

const SEVERITY_ORDER: Readonly<Record<string, number>> = { blocking: 0, warning: 1, info: 2 };

function sortWarnings(warnings: readonly PlanWarning[]): PlanWarning[] {
  const key = (warning: PlanWarning): string =>
    `${warning.code}:${JSON.stringify(warning.params ?? {})}`;
  return [...warnings].sort((a, b) => {
    const bySeverity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    return bySeverity !== 0 ? bySeverity : key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
}

/** The engine behind the `Hero` interface. Create it with `createHero`. */
class HeroEngine implements Hero {
  readonly #loaders: ReadonlyMap<string, SourceLoader>;
  readonly #detectors: readonly DetectorPlugin[];
  readonly #plans;
  readonly #cloud: CloudProvider;
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
    this.#cloud =
      options.cloud ??
      createAwsProvider({
        ...(options.cacheDirectory === undefined ? {} : { cacheDirectory: options.cacheDirectory }),
        ...(options.awsProfile === undefined ? {} : { profile: options.awsProfile }),
      });
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

  async plan(analysis: Analysis, options: PlanOptions = {}): Promise<DeploymentPlan> {
    const region = options.region ?? DEFAULT_REGION;
    if (!REGION.test(region)) throw heroError('plan.invalid-answer', { question: 'region' });
    if (options.accountId !== undefined && !ACCOUNT_ID.test(options.accountId)) {
      throw heroError('plan.invalid-answer', { question: 'accountId' });
    }

    return this.#phase('plan', async () => {
      const verified =
        options.accountId === undefined && options.useIdentity === true
          ? (await this.identity({ region })).account
          : options.accountId;
      const planned = planApplication({
        analysis,
        ...(options.answers === undefined ? {} : { answers: options.answers }),
      });

      // Without a verified account the plan is only a preview: it cannot be approved or deployed.
      const accountId = verified ?? UNVERIFIED_ACCOUNT;
      const warnings: PlanWarning[] = [...planned.warnings];
      if (verified === undefined) {
        warnings.push({ code: 'plan.account-unverified', severity: 'blocking' });
      }

      const deploymentId = deploymentIdFor(options.name ?? planned.spec.application.name);
      const described =
        planned.components.length === 0
          ? undefined
          : await this.#cloud.describe({
              strategy: planned.strategy,
              components: planned.components,
              region,
              accountId,
              deploymentId,
              inputs: planned.requiredInputs
                .filter((input) => input.name !== BUDGET_EMAIL_INPUT)
                .map((input) => ({ name: input.name, kind: input.kind })),
              allowNetwork: options.offline !== true,
            });
      warnings.push(...(described?.warnings ?? []));

      const body: PlanBody = {
        application: planned.spec.application.name,
        specVersion: planned.spec.version,
        sourceHash: analysis.sourceHash,
        strategy: planned.strategy,
        strategyRationale: planned.strategyRationale,
        target: { provider: this.#cloud.id, region, accountId },
        changes: described?.changes ?? [],
        warnings: sortWarnings(warnings),
        requiredInputs: planned.requiredInputs,
        ...(described === undefined ? {} : { cost: described.cost }),
        artifactHash: described?.artifactHash ?? EMPTY_ARTIFACT_HASH,
      };
      const plan = sealPlan(body);
      await this.#plans.put(plan);
      return plan;
    });
  }

  async identity(options: { readonly region?: string } = {}): Promise<CallerIdentity> {
    if (this.#cloud.identity === undefined) {
      throw heroError('provider.unavailable', { reason: 'no-identity' });
    }
    return this.#cloud.identity(options);
  }

  /** Finds a plan this engine produced. Anything else, or a plan altered since sealing, is refused. */
  async #resolvePlan(ref: PlanRef): Promise<DeploymentPlan> {
    const stored = await this.#plans.get(ref.id);
    if (stored === undefined) throw heroError('plan.unknown');
    if (stored.digest !== ref.digest || !isSealIntact(stored)) throw heroError('plan.tampered');
    return stored;
  }

  async requestApproval(plan: PlanRef): Promise<ApprovalChallenge> {
    const resolved = await this.#resolvePlan(plan);
    // A plan with a blocking warning cannot be approved: it would ask a person to agree to
    // something that Hero already knows it cannot do, or that is missing information.
    const blocking = resolved.warnings.filter((warning) => warning.severity === 'blocking');
    if (blocking.length > 0) throw heroError('plan.blocking-warning', { count: blocking.length });
    return this.#approvals.issue(resolved);
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
