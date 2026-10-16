import type { AudienceLevel } from '@hero-cloud/presentation';

/** The local runtime provides a disk-backed `StateStore` (see `@hero-cloud/core`) under `.hero/`. */

/**
 * Local runtime: everything that makes Hero work on one person's machine with their own AWS
 * account and their own AI. Nothing here talks to a Hero or Cloud Republic service.
 */

/** How Hero finds AWS credentials. It never asks for, copies, or stores key material itself. */
export type AwsCredentialSource =
  | { readonly kind: 'default-chain' }
  | { readonly kind: 'profile'; readonly profile: string }
  | { readonly kind: 'sso'; readonly profile: string }
  | { readonly kind: 'role'; readonly roleArn: string; readonly sourceProfile?: string };

/** Which AI the user brought. `none` keeps analysis fully deterministic. */
export type AiSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'local'; readonly provider: 'ollama'; readonly model: string }
  | {
      readonly kind: 'remote';
      readonly provider: string;
      readonly model: string;
      /** Where the key comes from: an environment variable name or a keychain entry. Never the key. */
      readonly keyRef: { readonly source: 'env' | 'keychain'; readonly name: string };
    };

export interface LocalConfig {
  readonly aws: AwsCredentialSource;
  readonly ai: AiSelection;
  readonly defaultRegion?: string;
  readonly audience: AudienceLevel;
  readonly locale: string;
}

/** Stores secrets in the operating system keychain, so Hero never writes keys to config files. */
export interface SecretStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

/** What the user agreed to send to a remote AI provider. Local models need no consent record. */
export interface AiConsent {
  readonly provider: string;
  readonly scope: 'file-names' | 'snippets' | 'full-files';
  readonly grantedAt: string;
}
