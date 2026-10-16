import { parseArgs } from 'node:util';
import { audienceLevels } from '@hero-cloud/presentation';
import { HeroError } from '@hero-cloud/sdk';
import type { AudienceLevel } from '@hero-cloud/presentation';

export type Command = 'analyze' | 'help' | 'version';

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
  } as const;

  if (values.version === true || first === 'version') return { ...base, command: 'version' };
  if (values.help === true || first === 'help' || first === undefined) {
    return { ...base, command: 'help' };
  }
  if (first !== 'analyze') throw usageError(`unknown command "${first}"`);
  if (rest.length !== 1)
    throw usageError(
      'analyze needs exactly one source: a folder, a .zip file, or an https:// repository',
    );
  return { ...base, command: 'analyze', source: rest[0], kind: kind as ParsedArguments['kind'] };
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
