/** Question codes the analyzer itself can raise, in addition to those raised by detectors. */
export const analyzerQuestionCodes = [
  'detector.failed',
  'merge.conflict',
  'repository-spec.invalid',
  'repository-spec.unverified',
] as const;

export { analyzeSnapshot } from './analyze.js';
export type { AnalyzerOptions } from './analyze.js';
export { createDetectionContext } from './context.js';
export { mergeContributions } from './merge.js';
export { toApplicationName } from './name.js';
export { reviewRepositorySpec } from './repository-spec.js';
