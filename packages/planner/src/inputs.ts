import type { RequiredInput } from '@hero-cloud/core';

/** Names that suggest a secret: tokens, keys, passwords, and credentials. */
const SECRET_NAME =
  /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|PASS|PRIVATE|CREDENTIALS?|SIGNING|SALT|DSN|API_?KEY|ACCESS_?KEY|AUTH)(?:_|$)|_KEY$|^KEY$/;
/** Front-end build variables end up in the public bundle, so they are settings, not secrets. */
const PUBLIC_PREFIXES = ['VITE_', 'NEXT_PUBLIC_', 'PUBLIC_', 'REACT_APP_', 'NUXT_PUBLIC_'];

/** The email that receives budget alerts. Stored only in the user's own AWS account. */
export const BUDGET_EMAIL_INPUT = 'BUDGET_ALERT_EMAIL';

export function isSecretName(name: string): boolean {
  if (PUBLIC_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  return SECRET_NAME.test(name);
}

/** What a person must supply before deploying: the names the application reads, plus the budget email. */
export function requiredInputs(environment: readonly string[] | undefined): RequiredInput[] {
  const inputs: RequiredInput[] = [...(environment ?? [])].sort().map((name) => ({
    name,
    kind: isSecretName(name) ? ('secret' as const) : ('config' as const),
    reason: { code: isSecretName(name) ? 'input.secret' : 'input.config', params: { name } },
  }));
  inputs.push({ name: BUDGET_EMAIL_INPUT, kind: 'config', reason: { code: 'input.budget-email' } });
  return inputs;
}
