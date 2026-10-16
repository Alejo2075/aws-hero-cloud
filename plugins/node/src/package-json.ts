import type { DetectionContext } from '@hero-cloud/plugin-sdk';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** The few fields of `package.json` that detectors use. Everything is untrusted input. */
export interface PackageInfo {
  readonly name: string | undefined;
  readonly main: string | undefined;
  readonly type: string | undefined;
  readonly scripts: Readonly<Record<string, string>>;
  /** Runtime dependencies. Servers, data drivers, and auth libraries are looked up here only. */
  readonly dependencies: ReadonlySet<string>;
  readonly allDependencies: ReadonlySet<string>;
  readonly versions: ReadonlyMap<string, string>;
  readonly engines: string | undefined;
  readonly packageManagerField: string | undefined;
  readonly workspaces: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export async function readPackageJson(context: DetectionContext): Promise<PackageInfo | undefined> {
  const raw = await context.readJson('package.json');
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const json = raw as Record<string, unknown>;
  const dependencies = strings(json.dependencies);
  const dev = { ...strings(json.devDependencies), ...strings(json.optionalDependencies) };
  const all = { ...dev, ...dependencies };
  const engines = record(json.engines).node;
  return {
    name: typeof json.name === 'string' ? json.name : undefined,
    main: typeof json.main === 'string' ? json.main : undefined,
    type: typeof json.type === 'string' ? json.type : undefined,
    scripts: strings(json.scripts),
    dependencies: new Set(Object.keys(dependencies)),
    allDependencies: new Set(Object.keys(all)),
    versions: new Map(Object.entries(all)),
    engines: typeof engines === 'string' ? engines : undefined,
    packageManagerField: typeof json.packageManager === 'string' ? json.packageManager : undefined,
    workspaces:
      Array.isArray(json.workspaces) ||
      (typeof json.workspaces === 'object' && json.workspaces !== null),
  };
}

const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

/** Which package manager the project uses, and how that was decided. */
export function detectPackageManager(
  context: DetectionContext,
  info: PackageInfo | undefined,
): { readonly manager: PackageManager; readonly evidence: string } {
  const field = info?.packageManagerField?.split('@')[0];
  if (field === 'pnpm' || field === 'yarn' || field === 'npm' || field === 'bun') {
    return { manager: field, evidence: 'field:packageManager' };
  }
  for (const [file, manager] of LOCKFILES) {
    if (context.has(file)) return { manager, evidence: `file:${file}` };
  }
  return { manager: 'npm', evidence: 'default:npm' };
}

/** `npm run build`, `pnpm run build`, and so on. */
export function runScript(manager: PackageManager, script: string): string {
  return `${manager} run ${script}`;
}

/** `npm start` and friends. */
export function startCommand(manager: PackageManager): string {
  return `${manager} start`;
}

export function dependencyEvidence(info: PackageInfo, name: string): string {
  return `dependency:${name}${info.versions.has(name) ? `@${info.versions.get(name) ?? ''}` : ''}`;
}
