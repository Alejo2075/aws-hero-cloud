import { canonicalJson } from '@hero-cloud/shared';
import type { OpenQuestion } from '@hero-cloud/core';
import type { Contribution } from '@hero-cloud/plugin-sdk';
import type {
  DataSpec,
  FrontendSpec,
  HeroSpec,
  ServiceSpec,
  StorageSpec,
} from '@hero-cloud/specification';
import { HERO_SPEC_VERSION } from '@hero-cloud/specification';

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_ENV = 200;

interface Ranked<T> {
  readonly value: T;
  readonly confidence: number;
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Keeps the most confident item per id; a different loser becomes a question. */
function resolve<T extends { readonly id: string }>(
  kind: string,
  items: readonly Ranked<T>[],
  questions: OpenQuestion[],
): T[] {
  const winners = new Map<string, Ranked<T>>();
  for (const item of items) {
    const current = winners.get(item.value.id);
    if (current === undefined) {
      winners.set(item.value.id, item);
      continue;
    }
    const same = canonicalJson(current.value) === canonicalJson(item.value);
    if (!same) {
      questions.push({
        id: `merge.${kind}.${item.value.id}`,
        code: 'merge.conflict',
        params: { kind, id: item.value.id },
      });
    }
    if (item.confidence > current.confidence) winners.set(item.value.id, item);
  }
  return [...winners.values()].map((ranked) => ranked.value).sort(byId);
}

export interface MergeInput {
  readonly name: string;
  readonly contributions: readonly Contribution[];
}

/** Combines what the detectors found into one Hero Spec. The result does not depend on input order. */
export function mergeContributions(input: MergeInput): {
  spec: HeroSpec;
  questions: OpenQuestion[];
} {
  const questions: OpenQuestion[] = [];
  const frontends: Ranked<FrontendSpec>[] = [];
  const services: Ranked<ServiceSpec>[] = [];
  const data: Ranked<DataSpec>[] = [];
  const storage: Ranked<StorageSpec>[] = [];
  const names: Ranked<string>[] = [];
  const environment = new Set<string>();
  const extensions = new Map<string, unknown>();
  let auth: boolean | undefined;

  for (const contribution of input.contributions) {
    switch (contribution.kind) {
      case 'name':
        names.push({ value: contribution.value, confidence: contribution.confidence });
        break;
      case 'frontend':
        frontends.push({ value: contribution.value, confidence: contribution.confidence });
        break;
      case 'service':
        services.push({ value: contribution.value, confidence: contribution.confidence });
        break;
      case 'data':
        data.push({ value: contribution.value, confidence: contribution.confidence });
        break;
      case 'storage':
        storage.push({ value: contribution.value, confidence: contribution.confidence });
        break;
      case 'auth':
        auth = (auth ?? false) || contribution.required;
        break;
      case 'environment':
        for (const name of contribution.names) if (ENV_NAME.test(name)) environment.add(name);
        break;
      case 'extension': {
        const previous = extensions.get(contribution.key);
        const isObject = (value: unknown): value is Record<string, unknown> =>
          typeof value === 'object' && value !== null && !Array.isArray(value);
        extensions.set(
          contribution.key,
          isObject(previous) && isObject(contribution.value)
            ? { ...previous, ...contribution.value }
            : contribution.value,
        );
        break;
      }
    }
  }

  // One frontend per application: the most confident wins, and a different runner-up is a question.
  const [frontend] = [...frontends].sort((a, b) => b.confidence - a.confidence);
  if (frontends.length > 1) {
    const distinct = new Set(frontends.map((item) => canonicalJson(item.value)));
    if (distinct.size > 1) {
      questions.push({
        id: 'merge.frontend',
        code: 'merge.conflict',
        params: { kind: 'frontend', id: 'frontend' },
      });
    }
  }

  const mergedServices = resolve('service', services, questions);
  const mergedData = resolve('data', data, questions);
  const mergedStorage = resolve('storage', storage, questions);
  const sortedEnv = [...environment].sort().slice(0, MAX_ENV);
  const sortedExtensions = [...extensions.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

  const spec: HeroSpec = {
    version: HERO_SPEC_VERSION,
    application: { name: input.name },
    ...(frontend === undefined ? {} : { frontend: frontend.value }),
    ...(mergedServices.length > 0 ? { services: mergedServices } : {}),
    ...(mergedData.length > 0 ? { data: mergedData } : {}),
    ...(mergedStorage.length > 0 ? { storage: mergedStorage } : {}),
    ...(auth === undefined ? {} : { auth: { required: auth } }),
    ...(sortedEnv.length > 0 ? { environment: sortedEnv } : {}),
    ...(sortedExtensions.length > 0 ? { extensions: Object.fromEntries(sortedExtensions) } : {}),
  };
  return { spec, questions };
}

/** The most confident name offered by detectors, if any. */
export function pickName(contributions: readonly Contribution[]): string | undefined {
  const names = contributions.filter(
    (c): c is Extract<Contribution, { kind: 'name' }> => c.kind === 'name',
  );
  return [...names].sort((a, b) => b.confidence - a.confidence)[0]?.value;
}
