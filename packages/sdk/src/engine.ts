import { basename } from 'node:path';
import { analyzeSnapshot, toApplicationName } from '@hero-cloud/analyzer';
import {
  ApprovalService,
  InMemoryPlanStore,
  InMemoryStateStore,
  destroyArtifactHash,
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
  DeploymentLock,
  DeploymentPlan,
  DeployOptions,
  DeploymentResult,
  Endpoint,
  Health,
  Hero,
  HeroEvent,
  HeroEventListener,
  HeroPhase,
  HeroPorts,
  PlanBody,
  PlanOptions,
  PlanRef,
  PlanChange,
  PlanWarning,
  ProjectSnapshot,
  Rationale,
  SecretLocation,
  SetupReport,
  SecretSink,
  SourceLoader,
  StateStore,
  SourceRef,
} from '@hero-cloud/core';
import { nodePlugin } from '@hero-cloud/plugin-node';
import { BUDGET_EMAIL_INPUT, planApplication } from '@hero-cloud/planner';
import { createAwsProvider, createParameterSink } from '@hero-cloud/provider-aws';
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
  /** Where approved assemblies are kept so deploying later applies exactly what was approved. */
  readonly assemblyDirectory?: string;
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

/** Keeps two runs in this process from changing one deployment at once. */
class InProcessLock implements DeploymentLock {
  readonly #held = new Set<string>();

  acquire(deploymentId: string): Promise<() => Promise<void>> {
    if (this.#held.has(deploymentId)) return Promise.reject(heroError('deployment.locked'));
    this.#held.add(deploymentId);
    return Promise.resolve(() => {
      this.#held.delete(deploymentId);
      return Promise.resolve();
    });
  }
}

/** Whether something stored is the record of a deployment that currently exists. */
function isDeployedRecord(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schema?: unknown }).schema === 1 &&
    (value as { status?: unknown }).status === 'deployed'
  );
}

/** What the engine remembers about a plan so it can deploy it later: where the source came from. */
interface PlanContext {
  readonly source: { readonly source: SourceRef; readonly root: string | undefined } | undefined;
  readonly deploymentId: string;
  readonly components: readonly { id: string; kind: string; healthPath?: string }[];
}

/** What is stored for a deployment under `.hero/`. The AWS stack stays the source of truth. */
interface DeploymentRecord {
  readonly schema: 1;
  readonly status: 'deployed' | 'destroyed';
  readonly deploymentId: string;
  readonly plan: DeploymentPlan;
  readonly result: DeploymentResult;
  readonly source: PlanContext['source'];
  readonly components: PlanContext['components'];
}

/** The engine behind the `Hero` interface. Create it with `createHero`. */
class HeroEngine implements Hero {
  readonly #loaders: ReadonlyMap<string, SourceLoader>;
  readonly #detectors: readonly DetectorPlugin[];
  readonly #plans;
  readonly #cloud: CloudProvider;
  readonly #state: StateStore;
  readonly #sourceRefs = new Map<string, { source: SourceRef; root: string | undefined }>();
  readonly #contexts = new Map<string, PlanContext>();
  readonly #locks: DeploymentLock;
  readonly #secrets: SecretSink | undefined;
  readonly #awsProfile: string | undefined;
  readonly #defaultSecrets: boolean;
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
        ...(options.assemblyDirectory === undefined
          ? {}
          : { assemblyDirectory: options.assemblyDirectory }),
      });
    this.#state = options.state ?? new InMemoryStateStore();
    this.#locks = options.locks ?? new InProcessLock();
    this.#awsProfile = options.awsProfile;
    // Without a sink of their own, secrets go to the AWS parameter store, but only when the cloud
    // is the built-in AWS provider; a custom cloud must bring its own sink.
    this.#secrets = options.secrets;
    this.#defaultSecrets = options.cloud === undefined;
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
        const analysis = await analyzeSnapshot(snapshot, {
          detectors: this.#detectors,
          name,
          ...(options.root === undefined ? {} : { root: options.root }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        this.#sourceRefs.set(analysis.sourceHash, { source, root: options.root });
        return analysis;
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

      // An update is shown as what will really change in what exists now, not as a new deployment.
      let changes: readonly PlanChange[] = described?.changes ?? [];
      const existing = await this.#state.read(deploymentId);
      if (described !== undefined && isDeployedRecord(existing)) {
        const diff = this.#cloud.diff?.bind(this.#cloud);
        let reason: string | undefined;
        if (options.offline === true) reason = 'offline';
        else if (diff === undefined) reason = 'unsupported';
        else if (options.accountId === undefined && !options.useIdentity) reason = 'no-account';
        if (reason === undefined && diff !== undefined) {
          try {
            changes = await diff({
              deploymentId,
              artifactHash: described.artifactHash,
              accountId,
              region,
              fresh: described.changes,
            });
          } catch {
            reason = 'failed';
          }
        }
        if (reason !== undefined) {
          warnings.push({
            code: 'plan.update-unverified',
            severity: 'warning',
            params: { reason },
          });
        }
        const destructive = changes.filter((change) => change.destructive).length;
        if (destructive > 0) {
          warnings.push({
            code: 'plan.destructive-changes',
            severity: 'warning',
            params: { count: destructive },
          });
        }
      }

      const body: PlanBody = {
        application: planned.spec.application.name,
        specVersion: planned.spec.version,
        sourceHash: analysis.sourceHash,
        strategy: planned.strategy,
        strategyRationale: planned.strategyRationale,
        target: { provider: this.#cloud.id, region, accountId },
        changes,
        warnings: sortWarnings(warnings),
        requiredInputs: planned.requiredInputs,
        ...(described === undefined ? {} : { cost: described.cost }),
        artifactHash: described?.artifactHash ?? EMPTY_ARTIFACT_HASH,
      };
      const plan = sealPlan(body);
      await this.#plans.put(plan);
      this.#contexts.set(plan.id, {
        source: this.#sourceRefs.get(analysis.sourceHash),
        deploymentId,
        components: planned.components.map((component) => ({
          id: component.id,
          kind: component.kind,
          ...(typeof component.settings.healthPath === 'string'
            ? { healthPath: component.settings.healthPath }
            : {}),
        })),
      });
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

  async deploy(
    ref: PlanRef,
    approval: Approval,
    options: DeployOptions = {},
  ): Promise<DeploymentResult> {
    const plan = await this.#resolvePlan(ref);
    const blocking = plan.warnings.filter((warning) => warning.severity === 'blocking');
    if (blocking.length > 0) throw heroError('plan.blocking-warning', { count: blocking.length });
    // Consumes the challenge: an approval works once, for exactly this plan, account, and region.
    await this.#approvals.consume(plan, approval);

    if (plan.intent === 'destroy') return this.#destroy(plan);
    if (plan.intent === 'bootstrap') return this.#prepareAccount(plan);

    const cloud = this.#cloud;
    const apply = cloud.apply?.bind(cloud);
    if (apply === undefined) throw heroError('provider.unavailable', { reason: 'no-apply' });
    const context = this.#contexts.get(plan.id);
    if (context === undefined) throw heroError('plan.unknown');
    await this.#assertAccount(plan);

    const parameters: Record<string, string> = {};
    const email = options.inputs?.[BUDGET_EMAIL_INPUT];
    if (email !== undefined) parameters.BudgetEmail = email;
    if (
      plan.requiredInputs.some((input) => input.name === BUDGET_EMAIL_INPUT) &&
      email === undefined &&
      plan.changes.some((change) => change.resource.type === 'budgets-budget')
    ) {
      throw heroError('plan.missing-input', { name: BUDGET_EMAIL_INPUT });
    }

    return this.#locked(context.deploymentId, async () => {
      await this.#storeSecrets(plan, context.deploymentId, options.secrets);
      const snapshot = await this.#reloadSource(plan, context);
      try {
        const outputs = await this.#phase('deploy', () =>
          apply({
            plan,
            snapshot: snapshot.view,
            parameters,
            deploymentId: context.deploymentId,
            emit: (event) => {
              this.#emit(event);
            },
          }),
        );
        const health = await this.#phase('verify', () =>
          this.#observe(context.deploymentId, plan, outputs.endpoints, context.components),
        );
        const result: DeploymentResult = {
          deploymentId: context.deploymentId,
          planId: plan.id,
          status: health.status === 'healthy' ? 'succeeded' : 'partial',
          endpoints: outputs.endpoints,
          health,
          resources: outputs.resources,
          sensitiveOutputs: outputs.sensitiveOutputs,
          links: outputs.links,
          ...(plan.cost === undefined ? {} : { cost: plan.cost }),
          nextSteps: nextStepsFor(plan, outputs.endpoints, health),
          completedAt: this.#clock.now().toISOString(),
        };
        const record: DeploymentRecord = {
          schema: 1,
          status: 'deployed',
          deploymentId: context.deploymentId,
          plan,
          result,
          source: context.source,
          components: context.components,
        };
        await this.#state.write(context.deploymentId, record);
        return result;
      } finally {
        await snapshot.dispose();
      }
    });
  }

  async planDestroy(deploymentId: string): Promise<DeploymentPlan> {
    const record = await this.#record(deploymentId);
    const deployed = record.plan;
    const kept = deployed.changes.filter(
      (change) => (change.details as { onDestroy?: string } | undefined)?.onDestroy === 'keep',
    );
    const warnings: PlanWarning[] = [];
    if (kept.length > 0) {
      warnings.push({
        code: 'plan.destroy-keeps-data',
        severity: 'warning',
        params: { count: kept.length },
      });
    }
    const body: PlanBody = {
      application: deployed.application,
      specVersion: deployed.specVersion,
      sourceHash: deployed.sourceHash,
      strategy: deployed.strategy,
      strategyRationale: deployed.strategyRationale,
      target: deployed.target,
      changes: deployed.changes.map((change) => ({
        ...change,
        action: 'delete' as const,
        destructive: true,
      })),
      warnings: sortWarnings(warnings),
      requiredInputs: [],
      artifactHash: destroyArtifactHash(deploymentId, deployed.artifactHash),
      intent: 'destroy',
      deploymentId,
    };
    const plan = sealPlan(body);
    await this.#plans.put(plan);
    return plan;
  }

  async inspectSetup(
    options: { readonly region?: string; readonly profile?: string } = {},
  ): Promise<SetupReport> {
    const inspect = this.#cloud.inspect?.bind(this.#cloud);
    if (inspect === undefined) throw heroError('provider.unavailable', { reason: 'no-inspect' });
    const region = options.region ?? DEFAULT_REGION;
    if (!REGION.test(region)) throw heroError('plan.invalid-answer', { question: 'region' });
    return inspect({
      region,
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    });
  }

  async planBootstrap(options: { readonly region?: string } = {}): Promise<DeploymentPlan> {
    const region = options.region ?? DEFAULT_REGION;
    if (!REGION.test(region)) throw heroError('plan.invalid-answer', { question: 'region' });
    const describe = this.#cloud.describeBootstrap?.bind(this.#cloud);
    if (describe === undefined || this.#cloud.bootstrap === undefined) {
      throw heroError('provider.unavailable', { reason: 'no-bootstrap' });
    }
    // Preparing an account is for the account the credentials belong to, and never the owner.
    const who = await this.identity({ region });
    const described = describe({ accountId: who.account, region });
    const plan = sealPlan({
      application: 'hero-account-setup',
      specVersion: '1',
      sourceHash: EMPTY_ARTIFACT_HASH,
      strategy: 'static',
      strategyRationale: [],
      target: { provider: this.#cloud.id, region, accountId: who.account },
      changes: described.changes,
      warnings: [],
      requiredInputs: [],
      artifactHash: described.artifactHash,
      intent: 'bootstrap',
      deploymentId: 'hero-bootstrap',
    });
    await this.#plans.put(plan);
    return plan;
  }

  async #prepareAccount(plan: DeploymentPlan): Promise<DeploymentResult> {
    const bootstrap = this.#cloud.bootstrap?.bind(this.#cloud);
    if (bootstrap === undefined)
      throw heroError('provider.unavailable', { reason: 'no-bootstrap' });
    await this.#assertAccount(plan);
    return this.#locked('hero-bootstrap', async () => {
      const outcome = await this.#phase('deploy', () =>
        bootstrap({
          plan,
          emit: (event) => {
            this.#emit(event);
          },
        }),
      );
      return {
        deploymentId: 'hero-bootstrap',
        planId: plan.id,
        kind: 'setup',
        status: 'succeeded',
        endpoints: [],
        health: {
          status: 'unknown',
          checkedAt: this.#clock.now().toISOString(),
          components: [],
          checks: [],
        },
        resources: [],
        sensitiveOutputs: [],
        links: [],
        nextSteps: [
          {
            code: 'next.use-deployer-role',
            ...(outcome.deployerRoleArn === undefined
              ? {}
              : { params: { role: outcome.deployerRoleArn } }),
          },
          { code: 'next.deploy-first-app' },
        ],
        completedAt: this.#clock.now().toISOString(),
      };
    });
  }

  async outputs(deploymentId: string): Promise<DeploymentResult> {
    return (await this.#record(deploymentId)).result;
  }

  async health(deploymentId: string): Promise<Health> {
    const record = await this.#record(deploymentId);
    if (record.status === 'destroyed') throw heroError('plan.unknown');
    const health = await this.#observe(
      deploymentId,
      record.plan,
      record.result.endpoints,
      record.components,
    );
    await this.#state.write(deploymentId, {
      ...record,
      result: { ...record.result, health },
    } satisfies DeploymentRecord);
    return health;
  }

  async #destroy(plan: DeploymentPlan): Promise<DeploymentResult> {
    const cloud = this.#cloud;
    const deploymentId = plan.deploymentId;
    const destroy = cloud.destroy?.bind(cloud);
    if (destroy === undefined || deploymentId === undefined) {
      throw heroError('provider.unavailable', { reason: 'no-destroy' });
    }
    const record = await this.#record(deploymentId);
    await this.#assertAccount(plan);
    return this.#locked(deploymentId, async () => {
      const outputs = await this.#phase('destroy', () =>
        destroy({
          plan,
          snapshot: undefined,
          parameters: {},
          deploymentId,
          deployedArtifactHash: record.plan.artifactHash,
          emit: (event) => {
            this.#emit(event);
          },
        }),
      );
      const result: DeploymentResult = {
        deploymentId,
        planId: plan.id,
        kind: 'removal',
        status: 'succeeded',
        endpoints: [],
        health: {
          status: 'unknown',
          checkedAt: this.#clock.now().toISOString(),
          components: [],
          checks: [],
        },
        resources: outputs.kept ?? [],
        sensitiveOutputs: record.result.sensitiveOutputs,
        links: [],
        nextSteps: (outputs.kept ?? []).length > 0 ? [{ code: 'next.review-kept-data' }] : [],
        completedAt: this.#clock.now().toISOString(),
      };
      await this.#state.write(deploymentId, {
        ...record,
        status: 'destroyed',
        result,
      } satisfies DeploymentRecord);
      return result;
    });
  }

  async #record(deploymentId: string): Promise<DeploymentRecord> {
    const stored = await this.#state.read(deploymentId);
    if (
      typeof stored !== 'object' ||
      stored === null ||
      (stored as { schema?: unknown }).schema !== 1
    ) {
      throw heroError('plan.unknown');
    }
    return stored as DeploymentRecord;
  }

  async #observe(
    deploymentId: string,
    plan: DeploymentPlan,
    endpoints: readonly Endpoint[],
    components: PlanContext['components'],
  ): Promise<Health> {
    if (this.#cloud.health === undefined) {
      return {
        status: 'unknown',
        checkedAt: this.#clock.now().toISOString(),
        components: [],
        checks: [],
      };
    }
    return this.#cloud.health({
      deploymentId,
      region: plan.target.region,
      accountId: plan.target.accountId,
      endpoints,
      components,
      now: () => this.#clock.now(),
    });
  }

  /** The credentials in use must belong to the account the plan was approved for. */
  async #assertAccount(plan: DeploymentPlan): Promise<void> {
    if (this.#cloud.identity === undefined) return;
    const who = await this.#cloud.identity({ region: plan.target.region });
    if (who.account !== plan.target.accountId) throw heroError('approval.account-mismatch');
  }

  async #locked<T>(deploymentId: string, work: () => Promise<T>): Promise<T> {
    const release = await this.#locks.acquire(deploymentId);
    try {
      return await work();
    } finally {
      await release();
    }
  }

  #sinkFor(region: string): SecretSink {
    if (this.#secrets !== undefined) return this.#secrets;
    if (!this.#defaultSecrets)
      throw heroError('provider.unavailable', { reason: 'no-secret-sink' });
    return createParameterSink({
      region,
      ...(this.#awsProfile === undefined ? {} : { profile: this.#awsProfile }),
    });
  }

  /**
   * Sends the secret values a person provided straight to their own secret store. Only names the
   * plan asked for are accepted. Values are not kept, logged, or put in any result or event.
   */
  async #storeSecrets(
    plan: DeploymentPlan,
    deploymentId: string,
    secrets: Readonly<Record<string, string>> | undefined,
  ): Promise<void> {
    const entries = Object.entries(secrets ?? {});
    if (entries.length === 0) return;
    const allowed = new Set(
      plan.requiredInputs.filter((input) => input.kind === 'secret').map((input) => input.name),
    );
    for (const [name] of entries) {
      if (!allowed.has(name)) throw heroError('plan.invalid-answer', { question: 'secret-name' });
    }
    const sink = this.#sinkFor(plan.target.region);
    for (const [name, value] of entries)
      await sink.put({ deploymentId, name, value, kind: 'secret' });
  }

  async setSecret(deploymentId: string, name: string, value: string): Promise<SecretLocation> {
    const record = await this.#record(deploymentId);
    if (record.status === 'destroyed') throw heroError('plan.unknown');
    const allowed = record.plan.requiredInputs.some(
      (input) => input.kind === 'secret' && input.name === name,
    );
    if (!allowed) throw heroError('plan.invalid-answer', { question: 'secret-name' });
    return this.#locked(deploymentId, () =>
      this.#sinkFor(record.plan.target.region).put({ deploymentId, name, value, kind: 'secret' }),
    );
  }

  /** Loads the source again and proves it is the one that was reviewed. */
  async #reloadSource(
    plan: DeploymentPlan,
    context: PlanContext,
  ): Promise<{ view: ProjectSnapshot | undefined; dispose(): Promise<void> }> {
    if (context.source === undefined) return { view: undefined, dispose: () => Promise.resolve() };
    const loader = this.#loaders.get(context.source.source.kind);
    if (loader === undefined) {
      throw heroError('source.unsupported', { kind: context.source.source.kind });
    }
    const snapshot = await loader.load(context.source.source);
    if (snapshot.hash !== plan.sourceHash) {
      await snapshot.dispose();
      throw heroError('approval.plan-mismatch', { reason: 'source-changed' });
    }
    return {
      view: rooted(snapshot, context.source.root),
      dispose: () => snapshot.dispose(),
    };
  }
}

/** Shows a monorepo's folder as if it were the whole project. */
function rooted(snapshot: ProjectSnapshot, root: string | undefined): ProjectSnapshot {
  if (root === undefined || root === '' || root === '.') return snapshot;
  const prefix = `${root.replace(/\/+$/, '')}/`;
  return {
    hash: snapshot.hash,
    skipped: snapshot.skipped,
    files: snapshot.files
      .filter((file) => file.path.startsWith(prefix))
      .map((file) => ({ ...file, path: file.path.slice(prefix.length) })),
    read: (path) => snapshot.read(`${prefix}${path}`),
    dispose: () => snapshot.dispose(),
  };
}

/** What a person can do next, as codes the interfaces word for their reader. */
function nextStepsFor(
  plan: DeploymentPlan,
  endpoints: readonly Endpoint[],
  health: Health,
): Rationale[] {
  const steps: Rationale[] = [];
  if (health.status === 'healthy' && endpoints.length > 0) steps.push({ code: 'next.open-site' });
  if (health.status !== 'healthy') steps.push({ code: 'next.check-health' });
  if (plan.requiredInputs.some((input) => input.kind === 'secret')) {
    steps.push({ code: 'next.set-secrets' });
  }
  steps.push({ code: 'next.watch-cost' }, { code: 'next.destroy' });
  return steps;
}

/**
 * Creates an engine. Every dependency is a port you can replace; the defaults read local folders,
 * ZIP files, and Git repositories, keep plans in memory, and never contact a Hero service.
 */
export function createHero(options: CreateHeroOptions = {}): Hero {
  return new HeroEngine(options);
}
