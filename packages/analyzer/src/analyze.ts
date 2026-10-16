import type { Analysis, Detection, OpenQuestion, ProjectSnapshot } from '@hero-cloud/core';
import { heroError } from '@hero-cloud/core';
import type { Contribution, DetectorPlugin } from '@hero-cloud/plugin-sdk';
import { validateHeroSpec } from '@hero-cloud/specification';
import { createDetectionContext } from './context.js';
import { mergeContributions, pickName } from './merge.js';
import { toApplicationName } from './name.js';
import { reviewRepositorySpec } from './repository-spec.js';

export interface AnalyzerOptions {
  readonly detectors: readonly DetectorPlugin[];
  /** Name to use when no detector names the application. */
  readonly name?: string;
  /** Analyze only this sub-folder of the snapshot. */
  readonly root?: string;
  /** Per-detector time limit. A detector that exceeds it is skipped and reported. */
  readonly detectorTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function byCapabilityThenConfidence(a: Detection, b: Detection): number {
  if (a.capability !== b.capability) return a.capability < b.capability ? -1 : 1;
  return b.confidence - a.confidence;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(heroError('source.timeout'));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs detectors over a snapshot and builds an `Analysis`. Deterministic: the same snapshot and
 * detectors give the same result. A detector that throws or hangs cannot break the analysis; it is
 * reported as a question and the rest continues. Nothing in the project is executed.
 */
export async function analyzeSnapshot(
  snapshot: ProjectSnapshot,
  options: AnalyzerOptions,
): Promise<Analysis> {
  const context = createDetectionContext(snapshot, options.root);
  const timeout = options.detectorTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const detections: Detection[] = [];
  const contributions: Contribution[] = [];
  const questions: OpenQuestion[] = [];

  for (const detector of options.detectors) {
    options.signal?.throwIfAborted();
    try {
      const finding = await withTimeout(detector.detect(context), timeout);
      detections.push(...finding.detections);
      contributions.push(...finding.contributions);
      questions.push(...finding.questions);
    } catch {
      questions.push({
        id: `detector.failed.${detector.id}`,
        code: 'detector.failed',
        params: { detector: detector.id },
      });
    }
  }

  const name = toApplicationName(pickName(contributions) ?? options.name);
  const merged = mergeContributions({ name, contributions });
  questions.push(...merged.questions);

  const review = await reviewRepositorySpec(context, merged.spec);
  detections.push(...review.detections);
  questions.push(...review.questions);

  const validated = validateHeroSpec(merged.spec);
  if (!validated.ok) {
    throw heroError('spec.invalid', {
      issues: validated.issues.map((issue) => `${issue.path}:${issue.code}`).join(','),
    });
  }

  const unique = new Map(questions.map((question) => [question.id, question]));
  return {
    spec: validated.spec,
    sourceHash: snapshot.hash,
    detections: detections.sort(byCapabilityThenConfidence),
    openQuestions: [...unique.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
    skipped: snapshot.skipped,
    aiAssisted: false,
  };
}
