/**
 * Hero Spec: the provider-neutral contract between understanding an application and choosing
 * infrastructure. It never names cloud resources. Draft: v1 is not frozen until the RFC lands.
 *
 * The Hero Spec version is independent of the Hero software version.
 */
export const HERO_SPEC_VERSION = '1' as const;
export type HeroSpecVersion = typeof HERO_SPEC_VERSION;

export interface CommandSpec {
  readonly command: string;
  readonly workingDirectory?: string;
}

export interface FrontendSpec {
  readonly framework: string;
  readonly build?: CommandSpec & { readonly output: string };
}

/**
 * `process` covers legacy or unclassified workloads: a long-running program that listens on a
 * port or runs on its own, with no framework Hero understands.
 */
export type ServiceKind = 'http' | 'worker' | 'scheduled' | 'process';

export interface ServiceSpec {
  readonly id: string;
  readonly type: ServiceKind;
  /** Free-form on purpose: `nodejs`, `python`, `php`, `java`, `dotnet`, `container`, ... */
  readonly runtime: string;
  readonly build?: CommandSpec;
  readonly start?: CommandSpec;
  readonly port?: number;
  /** Path Hero requests as a smoke check after deployment, e.g. `/health`. A path, never a URL. */
  readonly healthPath?: string;
  /** When a `scheduled` service runs, as a five-field cron expression such as `0 * * * *`. */
  readonly schedule?: string;
}

export type DataKind = 'key-value' | 'document' | 'relational' | 'cache' | 'search';

export interface DataSpec {
  readonly id: string;
  readonly type: DataKind;
  /** Engine hint when the application needs a specific one, e.g. `postgres` or `mysql`. */
  readonly engine?: string;
}

export type StorageKind = 'object' | 'file-system';

export interface StorageSpec {
  readonly id: string;
  readonly type: StorageKind;
}

export interface HeroSpec {
  readonly version: HeroSpecVersion;
  readonly application: { readonly name: string };
  readonly frontend?: FrontendSpec;
  readonly services?: readonly ServiceSpec[];
  readonly data?: readonly DataSpec[];
  readonly storage?: readonly StorageSpec[];
  readonly auth?: { readonly required: boolean };
  /** Names only. Values never belong in a Hero Spec. */
  readonly environment?: readonly string[];
  /** Vendor extensions. Every key starts with `x-`. */
  readonly extensions?: Readonly<Record<string, unknown>>;
}
