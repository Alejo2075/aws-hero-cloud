import { heroError } from '@hero-cloud/core';
import type { OpenQuestion } from '@hero-cloud/core';
import { validateHeroSpec } from '@hero-cloud/specification';
import type { DataSpec, HeroSpec, ServiceSpec, StorageSpec } from '@hero-cloud/specification';

const CRON = /^(?:[0-9*,/-]{1,40}\s+){4}[0-9*,/-]{1,40}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export interface AppliedAnswers {
  readonly spec: HeroSpec;
  /** Ids of the questions the answers resolved. */
  readonly resolved: ReadonlySet<string>;
}

function invalid(question: string): never {
  throw heroError('plan.invalid-answer', { question });
}

function withService(
  spec: HeroSpec,
  id: string,
  change: (service: ServiceSpec) => ServiceSpec,
): HeroSpec {
  return {
    ...spec,
    services: (spec.services ?? []).map((service) =>
      service.id === id ? change(service) : service,
    ),
  };
}

function withStorage(spec: HeroSpec, storage: StorageSpec): HeroSpec {
  const others = (spec.storage ?? []).filter((item) => item.id !== storage.id);
  return { ...spec, storage: [...others, storage].sort((a, b) => (a.id < b.id ? -1 : 1)) };
}

function command(value: string, question: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 200 || CONTROL.test(trimmed)) return invalid(question);
  return trimmed;
}

/**
 * Applies a person's answers to the Hero Spec. Answers are validated strictly, because they end up
 * in commands and settings: a value that is not exactly one of the allowed forms is refused with
 * `plan.invalid-answer`, and so is an answer to a question that does not exist (a typo would
 * otherwise be silently ignored).
 */
export function applyAnswers(
  spec: HeroSpec,
  questions: readonly OpenQuestion[],
  answers: Readonly<Record<string, string>>,
): AppliedAnswers {
  const known = new Map(questions.map((question) => [question.id, question]));
  const resolved = new Set<string>();
  let current = spec;

  for (const [id, raw] of Object.entries(answers)) {
    const question = known.get(id);
    if (question === undefined) return invalid(id);
    const service = typeof question.params?.service === 'string' ? question.params.service : 'api';

    switch (question.code) {
      case 'service.start-unknown': {
        const value = command(raw, id);
        current = withService(current, service, (item) => ({ ...item, start: { command: value } }));
        break;
      }
      case 'service.port-unknown': {
        const port = Number(raw);
        if (!/^\d{1,5}$/.test(raw.trim()) || port < 1 || port > 65535) return invalid(id);
        current = withService(current, service, (item) => ({ ...item, port }));
        break;
      }
      case 'frontend.build-missing': {
        const value = command(raw, id);
        if (current.frontend === undefined) return invalid(id);
        current = {
          ...current,
          frontend: { ...current.frontend, build: { command: value, output: 'dist' } },
        };
        break;
      }
      case 'scheduled.schedule-unknown': {
        const value = raw.trim().replace(/\s+/g, ' ');
        if (!CRON.test(value)) return invalid(id);
        current = withService(current, 'jobs', (item) => ({ ...item, schedule: value }));
        break;
      }
      case 'storage.uploads': {
        if (raw === 'object') current = withStorage(current, { id: 'assets', type: 'object' });
        else if (raw === 'file-system')
          current = withStorage(current, { id: 'disk', type: 'file-system' });
        else return invalid(id);
        break;
      }
      case 'storage.writes-to-disk':
      case 'data.sqlite-persistence': {
        if (raw !== 'yes' && raw !== 'no') return invalid(id);
        if (raw === 'yes') current = withStorage(current, { id: 'disk', type: 'file-system' });
        break;
      }
      case 'data.engine-unknown': {
        if (raw !== 'postgres' && raw !== 'mysql') return invalid(id);
        current = {
          ...current,
          data: (current.data ?? []).map((item): DataSpec =>
            item.type === 'relational' && item.engine === undefined
              ? { ...item, engine: raw }
              : item,
          ),
        };
        break;
      }
      case 'scheduled.inside-server': {
        if (raw !== 'split' && raw !== 'keep') return invalid(id);
        break;
      }
      default:
        // Questions about the project itself (monorepo, unrecognized, detector failures) cannot be
        // answered here; the fix is to analyze again.
        return invalid(id);
    }
    resolved.add(id);
  }

  const checked = validateHeroSpec(current);
  if (!checked.ok) return invalid('spec');
  return { spec: checked.spec, resolved };
}
