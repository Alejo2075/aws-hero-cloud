import type { AIProvider, Analysis, Detection, ProjectSnapshot } from '@hero-cloud/core';
import { validateHeroSpec } from '@hero-cloud/specification';
import type { DataKind, HeroSpec, ServiceKind, StorageKind } from '@hero-cloud/specification';
import { buildContext } from './context.js';
import type { ConsentScope } from './context.js';

/** The only thing a model is asked for, and the only thing Hero reads from its answer. */
export const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    frontend: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: { framework: { type: 'string' } },
      required: ['framework'],
    },
    services: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { enum: ['http', 'worker', 'scheduled', 'process'] },
          runtime: { type: 'string' },
          port: { type: ['integer', 'null'] },
          healthPath: { type: ['string', 'null'] },
          schedule: { type: ['string', 'null'] },
        },
        required: ['id', 'type', 'runtime'],
      },
    },
    data: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          type: { enum: ['key-value', 'document', 'relational', 'cache', 'search'] },
          engine: { type: ['string', 'null'] },
        },
        required: ['id', 'type'],
      },
    },
    storage: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, type: { enum: ['object', 'file-system'] } },
        required: ['id', 'type'],
      },
    },
    auth: { type: ['boolean', 'null'] },
  },
} as const;

const SERVICE_KINDS: readonly ServiceKind[] = ['http', 'worker', 'scheduled', 'process'];
const DATA_KINDS: readonly DataKind[] = ['key-value', 'document', 'relational', 'cache', 'search'];
const STORAGE_KINDS: readonly StorageKind[] = ['object', 'file-system'];
const ID = /^[a-z][a-z0-9-]{0,30}$/;
const RUNTIME = /^[a-z][a-z0-9.+-]{0,20}$/;
const ENGINE = /^[a-z][a-z0-9-]{0,20}$/;
const FRAMEWORK = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,30}$/;
const SAFE_PATH = /^\/[A-Za-z0-9._~/-]{0,100}$/;
const CRON = /^[0-9*/,-]+(?: [0-9*/,-]+){4}$/;

const rec = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export interface Refinement {
  readonly spec: HeroSpec;
  /** Fields the model filled, as readable paths such as `services.api.port`. */
  readonly applied: readonly string[];
  /** Things the model said that were not accepted, with the reason. Never the text itself. */
  readonly rejected: readonly string[];
}

/**
 * Merges a model's answer into the draft spec under strict rules. The model can only *add* what
 * the deterministic analysis did not find, and only a small set of plain facts: what kind of
 * program it is, its runtime, port, health path, schedule, the kind of data it keeps, and the
 * framework of a website. It cannot name commands, addresses, secrets, permissions, or cloud
 * resources, cannot change or remove anything already found, and every value is checked against a
 * pattern. If the result is not a valid Hero Spec, the answer is thrown away whole.
 */
export function applyRefinement(spec: HeroSpec, answer: unknown): Refinement {
  const applied: string[] = [];
  const rejected: string[] = [];
  const input = rec(answer);
  const reject = (what: string): void => {
    rejected.push(what);
  };

  let frontend = spec.frontend;
  const ai = rec(input.frontend);
  if (spec.frontend === undefined && typeof ai.framework === 'string') {
    const framework = ai.framework;
    if (FRAMEWORK.test(framework)) {
      // Only the kind of website. A folder or a command is never taken from a model: finished
      // files are shipped as they are, and building needs a command that a person has reviewed.
      frontend = { framework };
      applied.push('frontend');
    } else reject('frontend.framework');
  }

  const services = [...(spec.services ?? [])];
  for (const raw of list(input.services)) {
    const item = rec(raw);
    const id = str(item.id);
    const type = SERVICE_KINDS.find((k) => k === item.type);
    const runtime = str(item.runtime)?.toLowerCase();
    if (
      id === undefined ||
      !ID.test(id) ||
      type === undefined ||
      runtime === undefined ||
      !RUNTIME.test(runtime)
    ) {
      reject('services.invalid');
      continue;
    }
    const existing = services.findIndex((s) => s.id === id);
    const port =
      typeof item.port === 'number' &&
      Number.isInteger(item.port) &&
      item.port >= 1 &&
      item.port <= 65535
        ? item.port
        : undefined;
    const healthPath = str(item.healthPath);
    const safePath =
      healthPath !== undefined && SAFE_PATH.test(healthPath) && !healthPath.includes('..')
        ? healthPath
        : undefined;
    const schedule = str(item.schedule);
    const safeSchedule =
      schedule !== undefined && schedule.length <= 60 && CRON.test(schedule) ? schedule : undefined;
    if (item.port !== null && item.port !== undefined && port === undefined)
      reject(`services.${id}.port`);
    if (healthPath !== undefined && safePath === undefined) reject(`services.${id}.healthPath`);
    if (schedule !== undefined && safeSchedule === undefined) reject(`services.${id}.schedule`);

    if (existing !== -1) {
      const current = services[existing];
      if (current === undefined) continue;
      const fill: { port?: number; healthPath?: string; schedule?: string } = {};
      if (current.port === undefined && port !== undefined) {
        fill.port = port;
        applied.push(`services.${id}.port`);
      }
      if (current.healthPath === undefined && safePath !== undefined) {
        fill.healthPath = safePath;
        applied.push(`services.${id}.healthPath`);
      }
      if (
        current.type === 'scheduled' &&
        current.schedule === undefined &&
        safeSchedule !== undefined
      ) {
        fill.schedule = safeSchedule;
        applied.push(`services.${id}.schedule`);
      }
      services[existing] = { ...current, ...fill };
    } else if (!services.some((s) => s.type === type)) {
      services.push({
        id,
        type,
        runtime,
        ...(port === undefined ? {} : { port }),
        ...(safePath === undefined ? {} : { healthPath: safePath }),
        ...(type === 'scheduled' && safeSchedule !== undefined ? { schedule: safeSchedule } : {}),
      });
      applied.push(`services.${id}`);
    } else reject(`services.${id}.duplicate-type`);
  }

  const data = [...(spec.data ?? [])];
  for (const raw of list(input.data)) {
    const item = rec(raw);
    const id = str(item.id);
    const type = DATA_KINDS.find((k) => k === item.type);
    const engine = str(item.engine)?.toLowerCase();
    if (id === undefined || !ID.test(id) || type === undefined) {
      reject('data.invalid');
      continue;
    }
    if (engine !== undefined && !ENGINE.test(engine)) reject(`data.${id}.engine`);
    // Key-value tables need a key, and a key is never guessed: it stays an open question.
    if (data.some((d) => d.id === id || d.type === type)) continue;
    data.push({ id, type, ...(engine !== undefined && ENGINE.test(engine) ? { engine } : {}) });
    applied.push(`data.${id}`);
  }

  const storage = [...(spec.storage ?? [])];
  for (const raw of list(input.storage)) {
    const item = rec(raw);
    const id = str(item.id);
    const type = STORAGE_KINDS.find((k) => k === item.type);
    if (id === undefined || !ID.test(id) || type === undefined) {
      reject('storage.invalid');
      continue;
    }
    if (storage.some((s) => s.id === id || s.type === type)) continue;
    storage.push({ id, type });
    applied.push(`storage.${id}`);
  }

  let auth = spec.auth;
  if (auth === undefined && input.auth === true) {
    auth = { required: true };
    applied.push('auth');
  }

  // Anything else in the answer is ignored, and counted so a reviewer can see it happened.
  for (const key of Object.keys(input)) {
    if (!['frontend', 'services', 'data', 'storage', 'auth'].includes(key)) reject(`unknown-field`);
  }

  const next: HeroSpec = {
    ...spec,
    ...(frontend === undefined ? {} : { frontend }),
    ...(services.length === 0 ? {} : { services }),
    ...(data.length === 0 ? {} : { data }),
    ...(storage.length === 0 ? {} : { storage }),
    ...(auth === undefined ? {} : { auth }),
  };
  const checked = validateHeroSpec(next);
  if (!checked.ok) return { spec, applied: [], rejected: [...rejected, 'spec.invalid'] };
  return { spec: checked.spec, applied, rejected };
}

export interface RefineOptions {
  readonly analysis: Analysis;
  readonly snapshot: ProjectSnapshot;
  readonly ai: AIProvider;
  readonly scope: ConsentScope;
}

export interface RefineOutcome {
  readonly analysis: Analysis;
  readonly sent: { readonly files: number; readonly snippets: number; readonly redactions: number };
  readonly applied: readonly string[];
  readonly rejected: readonly string[];
}

/** Whether the deterministic analysis left enough open that a model is worth asking. */
export function needsHelp(analysis: Analysis): boolean {
  const spec = analysis.spec;
  const nothing = spec.frontend === undefined && (spec.services ?? []).length === 0;
  return nothing || analysis.openQuestions.some((q) => q.code === 'service.port-unknown');
}

/**
 * Asks the model to fill what the analysis could not find, and merges the answer under the rules
 * of `applyRefinement`. The result says it was AI-assisted only if something was actually filled,
 * and each filled field is recorded as evidence of kind `ai`.
 */
export async function refineWithAi(options: RefineOptions): Promise<RefineOutcome> {
  const { analysis } = options;
  const { context, redactions } = await buildContext(analysis, options.snapshot, options.scope);
  const sent = {
    files: context.files.length,
    snippets: Object.keys(context.snippets).length,
    redactions,
  };
  const answer = await options.ai.generate<unknown>({
    task: 'Describe what kind of application this is and fill only what is missing in the current description.',
    context,
    schema: REFINE_SCHEMA,
  });
  const result = applyRefinement(analysis.spec, answer);
  if (result.applied.length === 0) {
    return { analysis, sent, applied: [], rejected: result.rejected };
  }
  const filledPorts = new Set(
    result.applied.filter((a) => a.endsWith('.port')).map((a) => a.split('.')[1] ?? ''),
  );
  const detections: Detection[] = [
    ...analysis.detections,
    ...result.applied.map((field) => ({
      capability: capabilityOf(field),
      confidence: 0.5,
      evidence: [`ai:${field}`],
    })),
  ];
  return {
    analysis: {
      ...analysis,
      spec: result.spec,
      detections,
      openQuestions: analysis.openQuestions.filter(
        (q) =>
          !(
            q.code === 'service.port-unknown' &&
            (filledPorts.has(String(q.params?.service ?? '')) ||
              (filledPorts.size > 0 && q.params?.service === undefined))
          ),
      ),
      aiAssisted: true,
    },
    sent,
    applied: result.applied,
    rejected: result.rejected,
  };
}

function capabilityOf(field: string): string {
  if (field.startsWith('frontend')) return 'web-frontend';
  if (field.startsWith('services')) return 'process-service';
  if (field.startsWith('data')) return 'document-data';
  if (field.startsWith('storage')) return 'object-storage';
  return 'authentication';
}
