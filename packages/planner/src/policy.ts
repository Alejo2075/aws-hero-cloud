/**
 * What an open question means for a plan.
 *
 * - `blocks`: the plan cannot be approved until a person answers (or fixes the project).
 * - `advises`: the plan can go ahead, with a warning the person should read.
 * - `informs`: already visible in the analysis; the plan does not repeat it.
 */
export type QuestionEffect = 'blocks' | 'advises' | 'informs';

const EFFECTS: Readonly<Record<string, QuestionEffect>> = {
  'frontend.build-missing': 'blocks',
  'service.start-unknown': 'blocks',
  'service.port-unknown': 'advises',
  'scheduled.inside-server': 'advises',
  'scheduled.schedule-unknown': 'blocks',
  'data.sqlite-persistence': 'blocks',
  'data.engine-unknown': 'blocks',
  'storage.uploads': 'blocks',
  'storage.writes-to-disk': 'blocks',
  'monorepo.choose-package': 'blocks',
  'app.not-recognized': 'blocks',
  'detector.failed': 'advises',
  'merge.conflict': 'advises',
  'repository-spec.invalid': 'informs',
  'repository-spec.unverified': 'informs',
};

/** Unknown question codes advise rather than block: a new detector must not silently stop plans. */
export function effectOf(code: string): QuestionEffect {
  return EFFECTS[code] ?? 'advises';
}
