import { HeroError } from '@hero-cloud/shared';
import type { ErrorParams } from '@hero-cloud/shared';

/**
 * Every error the engine throws on purpose has a code from this list. Each code needs a message at
 * the three audience levels in `@hero-cloud/presentation`; a test enforces it.
 */
export const errorCodes = [
  'approval.digest-mismatch',
  'approval.account-mismatch',
  'approval.region-mismatch',
  'approval.expired',
  'approval.unknown-challenge',
  'approval.plan-mismatch',
  'plan.unknown',
  'plan.tampered',
  'plan.blocking-warning',
  'plan.missing-input',
  'identity.root-refused',
  'identity.unknown',
  'source.not-found',
  'source.too-large',
  'source.too-many-files',
  'source.unsafe-path',
  'source.unsupported',
  'source.timeout',
  'spec.invalid',
  'provider.unavailable',
  'deployment.failed',
  'deployment.locked',
  'internal.unexpected',
  'internal.not-implemented',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

/** Creates a typed engine error. */
export function heroError(code: ErrorCode, params?: ErrorParams, cause?: unknown): HeroError {
  return new HeroError(code, {
    ...(params === undefined ? {} : { params }),
    ...(cause === undefined ? {} : { cause }),
  });
}
