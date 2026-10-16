<p align="center">
  <img src="apps/web/public/brand/hero-cloud-logo-horizontal.png" alt="Hero Cloud" width="420" />
</p>

<p align="center"><strong>Give Hero any application. Hero deploys it to your AWS account and proves it works.</strong></p>

<p align="center">
  <a href="LICENSE">Apache 2.0</a> ·
  <a href="docs/PRODUCT.md">Product</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a> ·
  <a href=".github/CONTRIBUTING.md">Contributing</a>
</p>

> **Status: alpha, not yet exercised against a real AWS account.** Analysis, planning, cost estimates, safe builds, deploy, health, updates, secrets, and destroy are implemented and tested with mocks and synthesis. The run against a real sandbox account (`pnpm test:integration`) has not happened yet, so treat deploys as unproven. Studio, the MCP server, AI providers, and containers are on the [roadmap](docs/ROADMAP.md).

## Quick start

Needs Node.js 22.12+. Analyzing and planning need no AWS account.

```bash
npx @hero-cloud/cli analyze ./my-app     # what your app needs
npx @hero-cloud/cli plan ./my-app --offline --account-id 123456789012   # a plan and a cost range, no network
```

To deploy to your own account, sign in to AWS the usual way (a profile, SSO, or environment variables; never the account owner), then:

```bash
npx @hero-cloud/cli deploy ./my-app      # shows the plan; creates nothing until you approve it
npx @hero-cloud/cli health hero-my-app   # proof it works, and what that proof does not cover
npx @hero-cloud/cli destroy hero-my-app  # remove it (data is kept until you delete it)
```

Add `--level guided` or `--level expert` for more detail and `--locale es` for Spanish. Build it into your own product with [`@hero-cloud/sdk`](packages/sdk/README.md).

## Troubleshooting

| You see                                             | What it means                                                                     | What to do                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Exit code 3, "Before this can go online"            | The plan needs something from you (an answer, or a capability Hero cannot do yet) | Read the list; answer with `--answer <question>=<answer>` and run again        |
| "You are signed in to AWS as the account owner"     | Hero refuses root credentials                                                     | Use a limited user, role, or SSO profile (`--profile <name>`)                  |
| "The credentials belong to another account"         | The plan was approved for a different account                                     | Plan again with the credentials you want to use                                |
| Exit code 4                                         | It deployed, but the checks did not show it working                               | Run `health`, read the failed check, then look at the logs link                |
| "Another deployment of this app is already running" | A lock is held by another run                                                     | Wait for it, or remove a stale `.hero/locks/<name>.lock` if nothing is running |
| `plan.update-unverified` warning                    | Hero could not compare with what is deployed                                      | Treat the list as a template, not a diff; re-plan online with credentials      |
| Slow first `plan`                                   | Public AWS prices are being downloaded                                            | Use `--offline` for built-in prices, or wait once; they are cached             |

Set `HERO_DEBUG=1` for technical detail on errors. It never prints credentials or secret values.

## What it does

Hero takes an application of any age or origin (hand-written, AI-generated, or decades old), works out what it needs, picks the simplest way to run it on AWS, and shows you a plan. After **you** approve the exact plan, it deploys and then **proves the system is working**, explained at your level.

Hero runs **on your own computer**, with **your AWS account** and **your AI** (optional, and a local model works). There is no Hero account, no hosted service, and nobody in the middle.

```text
Your app ─► Understand ─► Plan ─► You approve ─► Deploy to your AWS ─► Health check ─► Link, status, cost
```

## One result, three levels

The same plan and result are shown to each reader at the depth they need. Cost, risks, destructive changes, and approval are never hidden.

|                       | `simple`                                  | `guided`                                  | `expert`                                 |
| --------------------- | ----------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| For                   | Never used AWS                            | Knows a little                            | Engineer or architect                    |
| Is it working?        | **Working**, with the time it was checked | Status per part and which check proved it | Every check with status code and latency |
| Reach it              | A link to open                            | Link, domain and address details          | URLs, IPs, ARNs, stack outputs           |
| Cost                  | "About $14 a month"                       | Cost per component                        | Estimate, confidence, pricing dimensions |
| If something is wrong | One tap to the right place                | Links to logs, metrics, cost              | Log groups, alarms, dashboards, commands |

Details in [docs/PRODUCT.md](docs/PRODUCT.md#what-you-get-back).

## A headless engine you can build on

The engine is a library, separate from every interface. It takes an input, understands it (with your AI, if you supply one), plans, and, once you pass in a person's approval, deploys to AWS and reports health. It has no UI, accounts, or hidden services, so you can build your own system on it: a hosted product, an internal platform, an agent, a CI bot. See [the engine](docs/ARCHITECTURE.md#the-engine).

## One engine, many doors

```text
 CLI    Studio (local web)    AI assistant (MCP)    Editor    CI    Your own product
   └────────────┴──────────────────┴─────────────────┴────────┴──────────┘
                                    ▼
                          Hero SDK ─► Engine ─► Your AWS account
```

Every interface is an adapter over the same SDK, so they all behave the same. An AI assistant can analyze and plan for you, but only a person can approve. The contract:

```ts
const hero = createHero({ ai, state }); // ports are injected: ai, state, locks, secrets, cloud, ...

const analysis = await hero.analyze({ kind: 'directory', location: './my-app' });
const plan = await hero.plan(analysis, { useIdentity: true });

const approval = await myApprovalUi.request(plan); // your system asks a person
if (approval) {
  const result = await hero.deploy(plan, approval, { inputs: { BUDGET_ALERT_EMAIL: email } });
  console.log(result.endpoints, result.health.status); // where it is, and whether it works
}
```

## Repository

```text
apps/web                  Public project site (Astro)
packages/core             Public contracts and engine orchestration
packages/specification    Hero Spec types (draft)
packages/sdk              Stable API; the single door into Hero
packages/presentation     Output levels and locales
docs/                     PRODUCT.md, ARCHITECTURE.md, ROADMAP.md
brand/                    Brand guidelines and palette
.github/                  CI, issue and PR templates, and community files
```

More packages (`analyzer`, `planner`, `deployment`, `sources`, `providers/aws`, `providers/ai`, `apps/cli`, `apps/studio`, ...) are created as the roadmap reaches them. Which package may depend on which is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#packages).

## Develop

Requires Node.js 22.12+ and pnpm 9+. No AWS account or AI key is needed for most work.

```bash
pnpm install
pnpm dev            # public site at http://localhost:4321
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Community

[Contributing](.github/CONTRIBUTING.md) · [Code of Conduct](.github/CODE_OF_CONDUCT.md) · [Governance](.github/GOVERNANCE.md) · [Security](.github/SECURITY.md) · [Support](.github/SUPPORT.md)

Hero Cloud is open source under [Apache 2.0](LICENSE), sponsored and initially maintained by Cloud Republic. It is not an AWS reseller or a managed hosting service.
