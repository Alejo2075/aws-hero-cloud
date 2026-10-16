import { parseArgs } from 'node:util';
import { audienceLevels } from '@hero-cloud/presentation';
import { HeroError } from '@hero-cloud/sdk';
import type { AudienceLevel } from '@hero-cloud/presentation';

export type Command =
  'analyze' | 'plan' | 'deploy' | 'destroy' | 'health' | 'outputs' | 'help' | 'version';

export interface ParsedArguments {
  readonly command: Command;
  readonly source: string | undefined;
  readonly kind: 'directory' | 'zip' | 'git' | undefined;
  readonly level: AudienceLevel;
  readonly locale: string;
  readonly json: boolean;
  readonly color: boolean | undefined;
  readonly noAi: boolean;
  readonly root: string | undefined;
  readonly name: string | undefined;
  readonly specFile: string | undefined;
  readonly region: string | undefined;
  readonly accountId: string | undefined;
  readonly offline: boolean;
  /** The plan digest a script approves instead of answering a prompt. */
  readonly approve: string | undefined;
  /** Email address for spending alerts. */
  readonly budgetEmail: string | undefined;
  /** A named AWS profile. */
  readonly profile: string | undefined;
  /** Where Hero keeps what it needs to find a deployment again. */
  readonly stateDir: string | undefined;
  /** Answers to open questions, keyed by question id. */
  readonly answers: Readonly<Record<string, string>>;
}

/** A mistake in the command line. Carries the stable code `usage`, so it has a localized message. */
function usageError(reason: string): HeroError {
  return new HeroError('usage', { params: { reason } });
}

const KINDS = ['directory', 'zip', 'git'] as const;

/** The default locale comes from the environment: `es_ES.UTF-8` becomes `es`. */
export function localeFromEnvironment(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env.HERO_LOCALE ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? '';
  const language = raw.split('.')[0]?.replace('_', '-') ?? '';
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language) ? language : 'en';
}

/** `--answer service.port-unknown=4000` becomes `{ 'service.port-unknown': '4000' }`. */
function parseAnswers(entries: readonly string[]): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const entry of entries) {
    const index = entry.indexOf('=');
    const id = index === -1 ? '' : entry.slice(0, index);
    const value = index === -1 ? '' : entry.slice(index + 1);
    if (!/^[a-z][a-z0-9.-]{0,80}$/.test(id) || value.length > 500) {
      throw usageError('--answer must look like question-id=answer');
    }
    if (id in answers) throw usageError(`--answer ${id} was given twice`);
    answers[id] = value;
  }
  return answers;
}

function isLevel(value: string): value is AudienceLevel {
  return (audienceLevels as readonly string[]).includes(value);
}

/**
 * Reads only `--level` and `--locale` from a command line that may be otherwise invalid, so that
 * even a usage error is worded for the reader who asked for a level and a language.
 */
export function peekRenderOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { readonly audience: AudienceLevel; readonly locale: string } {
  let level: string | undefined;
  let locale: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';
    const next = argv[index + 1];
    if (token === '--level' || token === '-l') level = next;
    else if (token.startsWith('--level=')) level = token.slice('--level='.length);
    else if (token === '--locale') locale = next;
    else if (token.startsWith('--locale=')) locale = token.slice('--locale='.length);
  }
  const fromEnv = env.HERO_LEVEL;
  const audience =
    [level, fromEnv].find(
      (value): value is AudienceLevel => value !== undefined && isLevel(value),
    ) ?? 'simple';
  const chosen =
    locale !== undefined && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale)
      ? locale
      : localeFromEnvironment(env);
  return { audience, locale: chosen };
}

export function parseArguments(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ParsedArguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        level: { type: 'string', short: 'l' },
        locale: { type: 'string' },
        json: { type: 'boolean' },
        'no-color': { type: 'boolean' },
        'no-ai': { type: 'boolean' },
        kind: { type: 'string' },
        root: { type: 'string' },
        name: { type: 'string' },
        spec: { type: 'string' },
        region: { type: 'string' },
        'account-id': { type: 'string' },
        offline: { type: 'boolean' },
        approve: { type: 'string' },
        'budget-email': { type: 'string' },
        profile: { type: 'string' },
        'state-dir': { type: 'string' },
        answer: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    throw usageError(
      error instanceof Error ? (error.message.split('\n')[0] ?? 'invalid') : 'invalid',
    );
  }
  const { values, positionals } = parsed;

  const levelText = values.level ?? env.HERO_LEVEL ?? 'simple';
  if (!isLevel(levelText)) throw usageError(`--level must be one of: ${audienceLevels.join(', ')}`);

  const kind = values.kind;
  if (kind !== undefined && !(KINDS as readonly string[]).includes(kind)) {
    throw usageError(`--kind must be one of: ${KINDS.join(', ')}`);
  }

  const locale = values.locale ?? localeFromEnvironment(env);
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale))
    throw usageError('--locale is not a valid language tag');

  const [first, ...rest] = positionals;
  if (values.approve !== undefined && !/^[0-9a-f]{64}$/.test(values.approve)) {
    throw usageError('--approve must be the 64-character digest of the plan');
  }
  const base = {
    source: undefined,
    kind: undefined,
    level: levelText,
    locale,
    json: values.json === true,
    color: values['no-color'] === true || env.NO_COLOR !== undefined ? false : undefined,
    noAi: values['no-ai'] === true,
    root: values.root,
    name: values.name,
    specFile: values.spec,
    region: values.region,
    accountId: values['account-id'],
    offline: values.offline === true,
    approve: values.approve,
    budgetEmail: values['budget-email'],
    profile: values.profile,
    stateDir: values['state-dir'],
    answers: parseAnswers(values.answer ?? []),
  } as const;

  if (values.version === true || first === 'version') return { ...base, command: 'version' };
  if (values.help === true || first === 'help' || first === undefined) {
    return { ...base, command: 'help' };
  }
  if (first === 'health' || first === 'outputs' || first === 'destroy') {
    const id = rest[0];
    if (rest.length !== 1 || id === undefined || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) {
      throw usageError(`${first} needs exactly one deployment name, such as hero-my-app`);
    }
    return { ...base, command: first, source: id, kind: undefined };
  }
  if (first !== 'analyze' && first !== 'plan' && first !== 'deploy') {
    throw usageError(`unknown command "${first}"`);
  }
  if (rest.length !== 1)
    throw usageError(
      `${first} needs exactly one source: a folder, a .zip file, or an https:// repository`,
    );
  return { ...base, command: first, source: rest[0], kind: kind as ParsedArguments['kind'] };
}

/** Decides what kind of source an argument is. */
export function sourceKind(
  source: string,
  explicit: ParsedArguments['kind'],
): 'directory' | 'zip' | 'git' {
  if (explicit !== undefined) return explicit;
  if (/^https:\/\//i.test(source)) return 'git';
  if (/\.zip$/i.test(source)) return 'zip';
  return 'directory';
}
