import type {
  Analysis,
  Component,
  DeploymentStrategy,
  OpenQuestion,
  PlanWarning,
  Rationale,
  RequiredInput,
} from '@hero-cloud/core';
import type { HeroSpec } from '@hero-cloud/specification';
import { applyAnswers } from './answers.js';
import { requiredInputs } from './inputs.js';
import { effectOf } from './policy.js';

export interface PlannerInput {
  readonly analysis: Analysis;
  readonly answers?: Readonly<Record<string, string>>;
}

/** What the planner decided, in provider-neutral terms. A provider turns it into resources. */
export interface PlannedApplication {
  /** The Hero Spec after the person's answers were applied. */
  readonly spec: HeroSpec;
  readonly strategy: DeploymentStrategy;
  readonly strategyRationale: readonly Rationale[];
  readonly components: readonly Component[];
  readonly warnings: readonly PlanWarning[];
  readonly requiredInputs: readonly RequiredInput[];
}

const DEFAULT_PORT = 8080;
const NODE_RUNTIME = /^nodejs/;
const MAX_EVIDENCE = 6;

/** Evidence for a capability, gathered from every detection of it. */
function evidenceFor(analysis: Analysis, capability: string): string[] {
  return [
    ...new Set(
      analysis.detections.filter((d) => d.capability === capability).flatMap((d) => d.evidence),
    ),
  ]
    .sort()
    .slice(0, MAX_EVIDENCE);
}

function rationale(analysis: Analysis, code: string, capability?: string): Rationale {
  const evidence = capability === undefined ? [] : evidenceFor(analysis, capability);
  return evidence.length === 0 ? { code } : { code, evidence };
}

interface Unsupported {
  readonly capability: string;
  readonly needs: DeploymentStrategy;
}

function unsupportedOf(spec: HeroSpec): Unsupported[] {
  const found = new Map<string, Unsupported>();
  const add = (capability: string, needs: DeploymentStrategy): void => {
    found.set(capability, { capability, needs });
  };
  for (const service of spec.services ?? []) {
    const supported =
      NODE_RUNTIME.test(service.runtime) &&
      (service.type === 'http' || service.type === 'scheduled');
    if (!supported)
      add(service.type === 'http' ? 'http-service' : `${service.type}-service`, 'container');
  }
  for (const item of spec.data ?? []) {
    if (item.type === 'relational') add('relational-data', 'container');
    else if (item.type === 'document') add('document-data', 'container');
    else if (item.type === 'cache') add('cache', 'container');
    else if (item.type === 'search') add('search', 'container');
  }
  if ((spec.storage ?? []).some((item) => item.type === 'file-system'))
    add('file-system-write', 'container');
  return [...found.values()].sort((a, b) => (a.capability < b.capability ? -1 : 1));
}

function componentsOf(spec: HeroSpec, analysis: Analysis): Component[] {
  const components: Component[] = [];
  if (spec.frontend !== undefined) {
    const staticOutput = (spec.extensions?.['x-static'] as { outputDirectory?: string } | undefined)
      ?.outputDirectory;
    components.push({
      id: 'site',
      kind: 'static-site',
      capability: 'web-frontend',
      settings: {
        framework: spec.frontend.framework,
        outputDirectory: spec.frontend.build?.output ?? staticOutput ?? '.',
        ...(spec.frontend.build === undefined ? {} : { buildCommand: spec.frontend.build.command }),
      },
      rationale: [rationale(analysis, 'frontend.static-site', 'web-frontend')],
    });
  }
  for (const service of spec.services ?? []) {
    if (service.type === 'http') {
      components.push({
        id: service.id,
        kind: 'http-service',
        capability: 'http-service',
        settings: {
          runtime: service.runtime,
          port: service.port ?? DEFAULT_PORT,
          ...(service.start === undefined ? {} : { startCommand: service.start.command }),
          ...(service.build === undefined ? {} : { buildCommand: service.build.command }),
          ...(service.healthPath === undefined ? {} : { healthPath: service.healthPath }),
        },
        rationale: [rationale(analysis, 'service.http.serverless', 'http-service')],
      });
    } else if (service.type === 'scheduled') {
      components.push({
        id: service.id,
        kind: 'scheduled-job',
        capability: 'scheduled-job',
        settings: {
          runtime: service.runtime,
          schedule: service.schedule ?? '0 * * * *',
          ...(service.start === undefined ? {} : { startCommand: service.start.command }),
          ...(service.build === undefined ? {} : { buildCommand: service.build.command }),
        },
        rationale: [rationale(analysis, 'service.scheduled.serverless', 'scheduled-job')],
      });
    }
  }
  for (const item of spec.data ?? []) {
    if (item.type === 'key-value') {
      components.push({
        id: item.id,
        kind: 'key-value-table',
        capability: 'key-value-data',
        settings: {
          billing: 'on-demand',
          pointInTimeRecovery: true,
          ...(item.key === undefined
            ? {}
            : {
                partitionKey: item.key.partition.name,
                partitionKeyType: item.key.partition.type,
                ...(item.key.sort === undefined
                  ? {}
                  : { sortKey: item.key.sort.name, sortKeyType: item.key.sort.type }),
              }),
        },
        rationale: [rationale(analysis, 'data.key-value.on-demand', 'key-value-data')],
      });
    }
  }
  for (const item of spec.storage ?? []) {
    if (item.type === 'object') {
      components.push({
        id: item.id,
        kind: 'object-bucket',
        capability: 'object-storage',
        settings: { blockPublicAccess: true, encryption: 'managed', versioning: true },
        rationale: [rationale(analysis, 'storage.object.private', 'object-storage')],
      });
    }
  }
  if (spec.auth?.required === true) {
    components.push({
      id: 'users',
      kind: 'identity',
      capability: 'authentication',
      settings: { signIn: 'email', selfSignUp: false },
      rationale: [rationale(analysis, 'auth.user-pool', 'authentication')],
    });
  }
  return components;
}

/** Guardrails (the budget alert) protect a deployment but never decide how it runs. */
function strategyFor(components: readonly Component[]): DeploymentStrategy {
  return components
    .filter((component) => component.kind !== 'budget-alert')
    .every((component) => component.kind === 'static-site')
    ? 'static'
    : 'serverless';
}

/**
 * Turns an analysis into a provider-neutral plan: the lowest strategy that works, the components it
 * needs, what a person must supply, and honest warnings. It is a pure function: the same analysis
 * and answers always give the same result. When Hero cannot do something yet, or does not know
 * enough, the result says so with a blocking warning instead of guessing.
 */
export function planApplication(input: PlannerInput): PlannedApplication {
  const { analysis } = input;
  const { spec, resolved } = applyAnswers(
    analysis.spec,
    analysis.openQuestions,
    input.answers ?? {},
  );
  const warnings: PlanWarning[] = [];

  const unresolved: OpenQuestion[] = analysis.openQuestions.filter(
    (question) => !resolved.has(question.id),
  );
  for (const question of unresolved) {
    const effect = effectOf(question.code);
    if (effect === 'informs') continue;
    warnings.push({
      code: 'plan.open-question',
      severity: effect === 'blocks' ? 'blocking' : 'warning',
      // The question's own parameters travel along, so the warning can be worded without a lookup.
      params: { ...question.params, question: question.id, kind: question.code },
    });
  }

  const unsupported = unsupportedOf(spec);
  if (unsupported.length > 0) {
    for (const item of unsupported) {
      warnings.push({
        code: 'plan.unsupported-capability',
        severity: 'blocking',
        params: { capability: item.capability, needs: item.needs },
      });
    }
    return {
      spec,
      strategy: 'container',
      strategyRationale: [
        {
          code: 'strategy.needs-container',
          evidence: unsupported.map((item) => `capability:${item.capability}`),
        },
      ],
      components: [],
      warnings: sortWarnings(warnings),
      requiredInputs: [],
    };
  }

  const components = componentsOf(spec, analysis);
  if (components.length === 0) {
    warnings.push({ code: 'plan.nothing-to-deploy', severity: 'blocking' });
    return {
      spec,
      strategy: 'static',
      strategyRationale: [{ code: 'strategy.static' }],
      components: [],
      warnings: sortWarnings(warnings),
      requiredInputs: [],
    };
  }

  components.push({
    id: 'budget',
    kind: 'budget-alert',
    capability: 'cost-control',
    settings: { monthlyLimitUsd: 10, alertAtPercent: 80 },
    rationale: [{ code: 'guardrail.budget' }],
  });

  const strategy = strategyFor(components);
  const inputs = requiredInputs(spec.environment);

  const publicKinds = [
    ...new Set(
      components
        .filter((c) => c.kind === 'static-site' || c.kind === 'http-service')
        .map((c) => c.kind),
    ),
  ];
  if (publicKinds.length > 0) {
    warnings.push({
      code: 'plan.public-exposure',
      severity: 'info',
      params: { kinds: publicKinds.join(',') },
    });
  }
  const secrets = inputs.filter((item) => item.kind === 'secret').length;
  if (secrets > 0)
    warnings.push({ code: 'plan.secrets-required', severity: 'info', params: { count: secrets } });
  if (analysis.detections.some((d) => d.evidence.includes('config:server-rendering'))) {
    warnings.push({ code: 'plan.ssr-cold-start', severity: 'info' });
  }

  return {
    spec,
    strategy,
    strategyRationale: [
      strategy === 'static'
        ? { code: 'strategy.static', evidence: evidenceFor(analysis, 'web-frontend') }
        : { code: 'strategy.serverless', evidence: strategyEvidence(components) },
    ],
    components: components.sort(byKindThenId),
    warnings: sortWarnings(warnings),
    requiredInputs: inputs,
  };
}

const KIND_ORDER: Readonly<Record<string, number>> = {
  'static-site': 0,
  'http-service': 1,
  'scheduled-job': 2,
  'key-value-table': 3,
  'object-bucket': 4,
  identity: 5,
  'budget-alert': 6,
};

function byKindThenId(a: Component, b: Component): number {
  const order = (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99);
  return order !== 0 ? order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The capabilities that moved the plan above `static`, as evidence for the choice. */
function strategyEvidence(components: readonly Component[]): string[] {
  return [
    ...new Set(
      components
        .filter((c) => c.kind !== 'static-site' && c.kind !== 'budget-alert')
        .map((c) => `capability:${c.capability}`),
    ),
  ].sort();
}

const SEVERITY_ORDER: Readonly<Record<string, number>> = { blocking: 0, warning: 1, info: 2 };

function sortWarnings(warnings: readonly PlanWarning[]): PlanWarning[] {
  return [...warnings].sort((a, b) => {
    const bySeverity = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
    if (bySeverity !== 0) return bySeverity;
    const key = (w: PlanWarning): string => `${w.code}:${JSON.stringify(w.params ?? {})}`;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
}
