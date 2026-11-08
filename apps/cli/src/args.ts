import { parseArgs } from 'node:util';
import { audienceLevels } from '@hero-cloud/presentation';
import { HeroError, aiKinds } from '@hero-cloud/sdk';
import type { AudienceLevel } from '@hero-cloud/presentation';
import { isProfileName } from './profile.js';

export type Command =
  | 'analyze'
  | 'plan'
  | 'deploy'
  | 'destroy'
  | 'health'
  | 'outputs'
  | 'secret'
  | 'setup'
  | 'mcp'
  | 'studio'
  | 'approve'
  | 'report'
  | 'help'
  | 'version';

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
  /** The AI model to ask for help with what analysis cannot tell: its kind, model, key variable. */
  readonly ai: string | undefined;
  readonly aiModel: string | undefined;
  readonly aiKeyEnv: string | undefined;
  readonly aiBaseUrl: string | undefined;
  /** What the person agrees to share: `file-names`, `snippets`, or `full-files`. */
  readonly aiScope: string | undefined;
  /** For `mcp`: the folders an assistant may analyze. */
  readonly allow: readonly string[];
  /** For `studio`: print the address instead of opening the browser. */
  readonly noOpen: boolean;
  /** For `setup`: prepare the account (an approved plan of its own). */
  readonly prepare: boolean;
  /** For `setup`: add a profile with this name that assumes the deployer role. */
  readonly writeProfile: string | undefined;
  /** For `secret`: the name of the secret to store. */
  readonly secretName: string | undefined;
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
        prepare: { type: 'boolean' },
        allow: { type: 'string', multiple: true },
        'no-open': { type: 'boolean' },
        ai: { type: 'string' },
        'ai-model': { type: 'string' },
        'ai-key-env': { type: 'string' },
        'ai-base-url': { type: 'string' },
        'ai-scope': { type: 'string' },
        'write-profile': { type: 'string' },
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

  if (values.ai !== undefined && !(aiKinds as readonly string[]).includes(values.ai)) {
    throw usageError(`--ai must be one of: ${aiKinds.join(', ')}`);
  }
  if (
    values['ai-scope'] !== undefined &&
    !['file-names', 'snippets', 'full-files'].includes(values['ai-scope'])
  ) {
    throw usageError('--ai-scope must be one of: file-names, snippets, full-files');
  }
  if (values['ai-key-env'] !== undefined && !/^[A-Z][A-Z0-9_]{0,63}$/.test(values['ai-key-env'])) {
    throw usageError('--ai-key-env must be the NAME of an environment variable, not the key');
  }
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
    secretName: undefined,
    prepare: values.prepare === true,
    allow: values.allow ?? [],
    noOpen: values['no-open'] === true,
    ai: values.ai,
    aiModel: values['ai-model'],
    aiKeyEnv: values['ai-key-env'],
    aiBaseUrl: values['ai-base-url'],
    aiScope: values['ai-scope'],
    writeProfile: values['write-profile'],
    budgetEmail: values['budget-email'],
    profile: values.profile,
    stateDir: values['state-dir'],
    answers: parseAnswers(values.answer ?? []),
  } as const;

  if (values.version === true || first === 'version') return { ...base, command: 'version' };
  if (values.help === true || first === 'help' || first === undefined) {
    return { ...base, command: 'help' };
  }
  if (first === 'mcp') {
    if (rest.length !== 0)
      throw usageError('mcp takes no source; use --allow <folder> to choose folders');
    return { ...base, command: 'mcp', source: undefined, kind: undefined };
  }
  if (first === 'studio') {
    if (rest.length !== 0)
      throw usageError('studio takes no source; use --allow <folder> to choose folders');
    return { ...base, command: 'studio', source: undefined, kind: undefined };
  }
  if (first === 'approve') {
    const [id] = rest;
    if (rest.length !== 1 || id === undefined || !/^req_[0-9a-f]{16}$/.test(id)) {
      throw usageError(
        'approve needs the request id an assistant gave you, such as req_0123456789abcdef',
      );
    }
    return { ...base, command: 'approve', source: id, kind: undefined };
  }
  if (first === 'setup') {
    if (rest.length !== 0) throw usageError('setup takes no source');
    if (values['write-profile'] !== undefined && !isProfileName(values['write-profile'])) {
      throw usageError('--write-profile needs an ordinary profile name, such as hero');
    }
    return { ...base, command: 'setup', source: undefined, kind: undefined };
  }
  if (first === 'secret') {
    const [id, name] = rest;
    if (
      rest.length !== 2 ||
      id === undefined ||
      name === undefined ||
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)
    ) {
      throw usageError(
        'secret needs a deployment name and a secret name, such as hero-my-app API_KEY',
      );
    }
    return { ...base, command: 'secret', source: id, kind: undefined, secretName: name };
  }
  if (first === 'health' || first === 'outputs' || first === 'destroy') {
    const id = rest[0];
    if (rest.length !== 1 || id === undefined || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) {
      throw usageError(`${first} needs exactly one deployment name, such as hero-my-app`);
    }
    return { ...base, command: first, source: id, kind: undefined };
  }
  if (first !== 'analyze' && first !== 'plan' && first !== 'deploy' && first !== 'report') {
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
