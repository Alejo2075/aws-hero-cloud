import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { heroError } from '@hero-cloud/core';
import type { CallerIdentity } from '@hero-cloud/core';

/** The part of an STS client Hero uses, so tests can supply a fake. */
export interface IdentityClient {
  send(command: GetCallerIdentityCommand): Promise<{
    Account?: string | undefined;
    Arn?: string | undefined;
  }>;
}

export interface IdentityOptions {
  readonly region?: string;
  /** A named profile from the shared AWS configuration. Without one the default chain is used. */
  readonly profile?: string;
  readonly client?: IdentityClient;
}

const ACCOUNT_ID = /^\d{12}$/;
const ARN = /^arn:aws[a-z-]*:(?:iam|sts)::(\d{12}):(.+)$/;

/**
 * Reads the kind of principal out of an ARN. The account owner (`root`) is recognised so Hero can
 * refuse it; `federated-user` and `assumed-role` cover SSO and role sessions.
 */
export function classifyPrincipal(arn: string): {
  account: string;
  kind: 'root' | CallerIdentity['kind'];
} {
  const match = ARN.exec(arn);
  if (match === null) throw heroError('identity.unknown', { reason: 'unexpected-arn' });
  const account = match[1] ?? '';
  const resource = match[2] ?? '';
  if (resource === 'root') return { account, kind: 'root' };
  if (resource.startsWith('user/')) return { account, kind: 'user' };
  if (resource.startsWith('assumed-role/') || resource.startsWith('role/')) {
    return { account, kind: 'role' };
  }
  if (resource.startsWith('federated-user/')) return { account, kind: 'federated' };
  return { account, kind: 'other' };
}

/**
 * Asks AWS who the configured credentials belong to, using the standard credential chain
 * (environment, profiles, SSO, instance roles). Refuses the account owner. Credentials are never
 * read, stored, or logged by Hero.
 */
export async function getIdentity(options: IdentityOptions = {}): Promise<CallerIdentity> {
  const client: IdentityClient =
    options.client ??
    new STSClient({
      region: options.region ?? 'us-east-1',
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    });
  let response;
  try {
    response = await client.send(new GetCallerIdentityCommand({}));
  } catch (error) {
    throw heroError('identity.unknown', { reason: 'call-failed' }, error);
  }
  const arn = response.Arn;
  if (arn === undefined || response.Account === undefined || !ACCOUNT_ID.test(response.Account)) {
    throw heroError('identity.unknown', { reason: 'incomplete-response' });
  }
  const { account, kind } = classifyPrincipal(arn);
  if (account !== response.Account)
    throw heroError('identity.unknown', { reason: 'account-mismatch' });
  if (kind === 'root') throw heroError('identity.root-refused');
  return { account, principal: arn, kind };
}
