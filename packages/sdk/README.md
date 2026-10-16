# @hero-cloud/sdk

The headless engine behind Hero and the single door into it. The CLI, a local server, an MCP
server, an editor extension, or your own product all use this and nothing deeper. It has no
prompts, no console output, no accounts, and no hosted service.

```ts
import { approvalFromChallenge, createHero } from '@hero-cloud/sdk';

const hero = createHero({ assemblyDirectory: '.hero/assemblies' });

const analysis = await hero.analyze({ kind: 'directory', location: './my-app' });
const plan = await hero.plan(analysis, { useIdentity: true }); // plans for the account your credentials belong to

if (plan.warnings.some((w) => w.severity === 'blocking')) {
  // The plan needs something first (an answer, a supported capability). Show plan.warnings.
}

// Your product shows the plan to a person. Only their agreement may produce an approval.
const challenge = await hero.requestApproval(plan);
const approval = approvalFromChallenge(challenge, 'my-product');

const result = await hero.deploy(plan, approval, {
  inputs: { BUDGET_ALERT_EMAIL: 'me@example.com' },
});
console.log(result.endpoints, result.health.status); // where it is, and whether it works
```

## What to know

- **Approval is the boundary.** `deploy` accepts only an approval issued for that exact plan
  (digest, account, region), once. Never give the challenge to an AI agent.
- **Plans are sealed.** `plan.digest` covers everything that will be applied, including the
  infrastructure and the exact build commands. A plan with a blocking warning cannot be approved.
- **Ports.** `createHero` accepts `state`, `locks`, `secrets`, `plans`, `cloud`, `ai`, `logger`,
  and `sources`. The defaults keep state in memory; the CLI passes disk-backed ones. A different
  cloud implements `CloudProvider`.
- **Words are not in the engine.** Results carry codes and data. `@hero-cloud/presentation` turns
  them into text at three levels and in several languages.
- **Secrets** go through `deploy(..., { secrets })` or `hero.setSecret(...)` straight to your
  secret store and are never returned or kept.
- Updates, health (with drift), outputs, and destroy (also an approved plan) are on the same
  interface. See `examples/headless` in the repository for a complete program.

The public API is tracked in `api/sdk.api.md` and checked in CI. See
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#core-contracts).
