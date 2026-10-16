import { canonicalJson } from '@hero-cloud/shared';
import type { Detection, OpenQuestion } from '@hero-cloud/core';
import type { DetectionContext } from '@hero-cloud/plugin-sdk';
import { parseHeroSpec } from '@hero-cloud/specification';
import type { HeroSpec } from '@hero-cloud/specification';

export interface RepositorySpecReview {
  readonly detections: Detection[];
  readonly questions: OpenQuestion[];
}

function indexById<T extends { readonly id: string }>(
  items: readonly T[] | undefined,
): Map<string, T> {
  return new Map((items ?? []).map((item) => [item.id, item]));
}

/**
 * A `hero.yaml` inside the source is untrusted (D4): it can ask for build commands or public
 * exposure. It is never applied. It is validated, compared with what analysis found, and every
 * field that analysis did not confirm becomes a question for a person. To use a spec as written,
 * the user supplies it from outside the source.
 */
export async function reviewRepositorySpec(
  context: DetectionContext,
  analyzed: HeroSpec,
): Promise<RepositorySpecReview> {
  const path = ['hero.yaml', 'hero.yml'].find((candidate) => context.has(candidate));
  if (path === undefined) return { detections: [], questions: [] };

  const detections: Detection[] = [
    { capability: 'declared-spec', confidence: 0.2, evidence: [`file:${path}`] },
  ];
  const text = await context.readText(path, 256 * 1024);
  const parsed = text === undefined ? undefined : parseHeroSpec(text);
  if (parsed === undefined || !parsed.ok) {
    return {
      detections,
      questions: [
        { id: 'repository-spec', code: 'repository-spec.invalid', params: { file: path } },
      ],
    };
  }

  const declared = parsed.spec;
  const questions: OpenQuestion[] = [];
  const unverified = (field: string): void => {
    questions.push({
      id: `repository-spec.${field}`,
      code: 'repository-spec.unverified',
      params: { file: path, field },
    });
  };

  const groups: readonly (readonly [string, HeroSpec['services'], HeroSpec['services']])[] = [
    ['services', declared.services, analyzed.services],
  ];
  for (const [name, mine, theirs] of groups) {
    const known = indexById(theirs);
    for (const item of mine ?? []) {
      const match = known.get(item.id);
      if (match === undefined || canonicalJson(match) !== canonicalJson(item))
        unverified(`${name}.${item.id}`);
    }
  }
  for (const [name, mine, theirs] of [
    ['data', declared.data, analyzed.data],
    ['storage', declared.storage, analyzed.storage],
  ] as const) {
    const known = indexById<{ readonly id: string }>(theirs);
    for (const item of mine ?? []) {
      const match = known.get(item.id);
      if (match === undefined || canonicalJson(match) !== canonicalJson(item))
        unverified(`${name}.${item.id}`);
    }
  }
  if (
    declared.frontend !== undefined &&
    canonicalJson(declared.frontend) !== canonicalJson(analyzed.frontend ?? null)
  ) {
    unverified('frontend');
  }
  if (
    declared.auth !== undefined &&
    canonicalJson(declared.auth) !== canonicalJson(analyzed.auth ?? null)
  ) {
    unverified('auth');
  }
  const known = new Set(analyzed.environment ?? []);
  for (const name of declared.environment ?? [])
    if (!known.has(name)) unverified(`environment.${name}`);
  for (const key of Object.keys(declared.extensions ?? {})) unverified(`extensions.${key}`);

  return { detections, questions };
}
