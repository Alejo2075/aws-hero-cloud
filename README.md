<p align="center">
  <img src="./brand/hero-cloud-logo.gif" alt="Hero Cloud" width="640" />
</p>

<p align="center"><strong>Give Hero any application. Hero deploys it to your AWS account and proves it works.</strong></p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-FFD500?style=for-the-badge&labelColor=0B0B0F" /></a>
  <a href="https://github.com/Alejo2075/aws-hero-cloud/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Alejo2075/aws-hero-cloud/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0B0B0F&color=1E90FF" /></a>
  <img alt="Node.js 22.12+" src="https://img.shields.io/badge/node-22.12%2B-FFD500?style=for-the-badge&labelColor=0B0B0F" />
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-1E90FF?style=for-the-badge&labelColor=0B0B0F" />
  <a href=".github/CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-FFD500?style=for-the-badge&labelColor=0B0B0F" /></a>
</p>

<p align="center">
  <a href="https://alejo2075.github.io/aws-hero-cloud/">Website</a> ·
  <a href="docs/PRODUCT.md">Product</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href=".github/CONTRIBUTING.md">Contributing</a>
</p>

## What is Hero Cloud?

Hero Cloud is a free, open source tool that puts an application on **your own AWS account**. Point it at a folder, a ZIP file, or a Git repository. Hero reads it without running anything, works out what it needs, picks the simplest way to run it on AWS, and shows you a plan with a cost range. After **you** approve that exact plan, it deploys and then **proves the system works**, explained at the depth you choose.

It is built for people who have an application (hand-written, AI-generated, or decades old) and want it online without becoming cloud experts, and for engineers who want a plan they can inspect and a deployment they can trust.

Hero runs **on your own computer**, with **your AWS account** and, optionally, **your own AI** (a local model works too). There is no Hero account, no hosted service, no telemetry, and nobody in the middle.

```text
Your app ─► Understand ─► Plan ─► You approve ─► Deploy to your AWS ─► Health check ─► Link, status, cost
```

## Contents

[Features](#features) · [Quick start](#quick-start) · [Ways to use Hero](#ways-to-use-hero) · [How it works](#how-it-works) · [What Hero can deploy](#what-hero-can-deploy) · [Safety](#safety) · [The parts of the project](#the-parts-of-the-project) · [Use it as a library](#use-it-as-a-library) · [Develop](#develop) · [Contributing](#contributing) · [Documentation](#documentation) · [License](#license)

## Features

- **Any application.** Node, Python, PHP, Ruby, Go, Java, .NET, containers, static sites, single-page apps, workers, scheduled jobs, monorepos, and legacy stacks.
- **The simplest fit on AWS.** Hero picks a strategy (static, serverless, or container) and explains why it did not choose a lower one.
- **Cost before you commit.** A monthly range with its assumptions, never a single promise.
- **A person approves.** Nothing is created until you approve the exact plan, which is bound to a digest. An AI assistant can never approve.
- **Proof, not promises.** Health checks say what was observed and what they do not cover.
- **One result, three levels.** `simple`, `guided`, and `expert` show the same data at the depth you need, in English and Spanish.
- **Safe by default.** Sources are untrusted and never executed. Secrets are asked for, used once, and never stored in plans, results, or logs.
- **Update and destroy.** Redeploy changes, see destructive changes before they happen, and remove a deployment (data is kept until you delete it).
- **Optional AI.** Hero analyzes and plans without any AI. If you bring your own (Anthropic, OpenAI, an OpenAI-compatible server, Ollama, or Bedrock), you decide what it may read.
- **Many doors, one engine.** Command line, Studio in your browser, an AI assistant over MCP, or the SDK in your own product.

## Quick start

Needs Node.js 22.12+. Analyzing and planning need no AWS account.

```bash
npx @hero-cloud/cli analyze ./my-app                                     # what your app needs
npx @hero-cloud/cli plan ./my-app --offline --account-id 123456789012    # a plan and a cost range, no network
npx @hero-cloud/cli studio                                               # the same flow in your browser
```

To deploy to your own account, sign in to AWS the usual way (a profile, SSO, or environment variables; never the account owner). Not sure where you stand? `hero-cloud setup` checks your sign-in and what is missing, and `setup --prepare` readies the account once, after you approve a plan.

```bash
npx @hero-cloud/cli deploy ./my-app       # shows the plan; creates nothing until you approve it
npx @hero-cloud/cli health hero-my-app    # proof it works, and what that proof does not cover
npx @hero-cloud/cli outputs hero-my-app   # where it is: links, addresses, and costs
npx @hero-cloud/cli destroy hero-my-app   # remove it (data is kept until you delete it)
```

Add `--level guided` or `--level expert` for more detail and `--locale es` for Spanish. Something went wrong? See [Troubleshooting](docs/TROUBLESHOOTING.md).

## Ways to use Hero

| Door       | For                                      | How                                                                        |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| **CLI**    | Terminals, scripts, and CI               | `hero-cloud <command>`; `--json` for machine-readable output               |
| **Studio** | People who prefer a browser              | `hero-cloud studio`: choose a folder or ZIP, review, approve, watch deploy |
| **MCP**    | AI assistants that analyze and plan      | `hero-cloud mcp`: tools to analyze and plan, with no way to approve        |
| **SDK**    | Your own product, platform, bot, or tool | `@hero-cloud/sdk`: the single door; every other door is built on it        |

Every door is an adapter over the same engine, so they all behave the same. Studio runs only on `127.0.0.1`, signs you in with a one-time code, and checks the host, origin, and a CSRF token on every write.

### Commands

| Command                      | What it does                                                         |
| ---------------------------- | -------------------------------------------------------------------- |
| `analyze <source>`           | Reads the application and lists what it needs, with evidence         |
| `plan <source>`              | Chooses a strategy and shows the changes, warnings, and cost range   |
| `deploy <source>`            | Shows the plan, asks for approval, deploys, and checks health        |
| `health <deployment>`        | Runs the checks again and says what they do and do not prove         |
| `outputs <deployment>`       | Shows endpoints, links, and costs of a deployment                    |
| `secret <deployment> <NAME>` | Sets a secret the plan asked for, without echoing or storing it      |
| `destroy <deployment>`       | Plans and, once approved, removes a deployment                       |
| `setup [--prepare]`          | Checks your AWS sign-in and prepares the account with limited access |
| `studio` / `mcp`             | Starts the local web interface or the MCP server                     |
| `approve <request>`          | Lets a person approve a plan an assistant requested                  |
| `report <source>`            | Writes a report for an application Hero does not recognize           |

Run `hero-cloud --help` for every option. Exit codes: `0` ok, `1` failed, `2` wrong command, `3` plan blocked, `4` deployed but the checks did not show it working.

## How it works

1. **Source.** A folder, a ZIP, or an HTTPS Git repository is loaded as untrusted data. Hero never runs project code while analyzing.
2. **Analyzer.** Deterministic detectors (and, if you supply one, an AI) produce a provider-neutral **Hero Spec**: what the application needs, each need with evidence and a confidence level.
3. **Planner.** It chooses the simplest strategy that fits (`static`, `serverless`, `container`, with `virtual-machine` on the roadmap), lists every change, flags destructive ones, and estimates cost.
4. **Approval.** A person approves the exact plan. The approval is bound to the plan's digest, so what you approve is what is built.
5. **Deployment.** The AWS provider builds safely, synthesizes CloudFormation, and applies it to your account with least-privilege policies.
6. **Health.** Checks report what they observed, with links to logs, metrics, and cost.

### One result, three levels

The same plan and result are shown to each reader at the depth they need. Cost, risks, destructive changes, and the approval step are never hidden at any level.

|                       | `simple`                                  | `guided`                                  | `expert`                                 |
| --------------------- | ----------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| For                   | Never used AWS                            | Knows a little                            | Engineer or architect                    |
| Is it working?        | **Working**, with the time it was checked | Status per part and which check proved it | Every check with status code and latency |
| Reach it              | A link to open                            | Link, domain and address details          | URLs, IPs, ARNs, stack outputs           |
| Cost                  | "About $14 a month"                       | Cost per component                        | Estimate, confidence, pricing dimensions |
| If something is wrong | One tap to the right place                | Links to logs, metrics, cost              | Log groups, alarms, dashboards, commands |

## What Hero can deploy

| Strategy          | For                                             | Status         |
| ----------------- | ----------------------------------------------- | -------------- |
| `static`          | Static sites and single-page apps               | Available      |
| `serverless`      | APIs, workers, and scheduled jobs               | Available      |
| `container`       | Servers with state, databases, and file storage | Available      |
| `virtual-machine` | Stacks that cannot be containerized             | On the roadmap |

The [`examples/`](examples) folder has a sample for each kind of application: static site, SPA, SPA with API, API only, Express with Postgres, API with DynamoDB, Django, FastAPI, Flask, Rails, Laravel, WordPress, plain PHP, Spring, .NET, Go, a Dockerfile app, a Procfile worker, a scheduled job, a monorepo, and a headless SDK example. If Hero does not recognize your application, `hero-cloud report <source>` writes a report you can read and, if you choose, share.

## Safety

- **A person approves; an agent never does.** `deploy` needs an approval bound to the plan digest, and the MCP server has no approve tool.
- **Nothing hidden.** Costs, destructive changes, warnings, and the limits of a health check are shown at every level.
- **Health states only what was observed.** Hero never reports "working" beyond what a check showed.
- **Secrets stay yours.** Plans, results, and events carry the names and locations of secrets, never their values.
- **Untrusted input.** Git repositories and ZIPs are treated as hostile: Hero never runs their code, and ZIP uploads are size-limited and checked.
- **Least privilege.** Deployments use limited policies, and Hero refuses to run as the AWS account owner.
- **Local-first.** No accounts, no hosted service, no default telemetry.

Found a vulnerability? Report it privately as described in [Security](.github/SECURITY.md).

## The parts of the project

```text
apps/cli                  The hero-cloud command line
apps/studio               Studio, the local web interface (React and Pixelact UI)
apps/web                  Public project site (Astro); it never runs the engine
packages/sdk              Stable API; the single door into Hero
packages/core             Public contracts and engine orchestration
packages/specification    Hero Spec types
packages/sources          Directories, ZIPs, and Git repositories, treated as untrusted
packages/analyzer         Provider-neutral needs, with evidence and confidence
packages/planner          Strategy, plan, and cost range
packages/providers/aws    AWS and CloudFormation: synthesis, deploy, health, destroy
packages/providers/ai     Optional AI providers (cloud or local)
packages/presentation     Output levels and locales; the only package that writes words
packages/local            File-based state, locks, and consent for local use
packages/mcp              MCP server for AI assistants
packages/server           The local server behind Studio
packages/plugin-sdk       Contracts for stack plugins
plugins/                  Stack plugins: node, container, legacy
examples/                 Sample applications
docs/                     Product, architecture, roadmap, troubleshooting
brand/                    Brand guidelines, palette, and logo
```

```text
 CLI    Studio (local web)    AI assistant (MCP)    Editor    CI    Your own product
   └────────────┴──────────────────┴─────────────────┴────────┴──────────┘
                                    ▼
                          Hero SDK ─► Engine ─► Your AWS account
```

The engine is **headless**: it prints nothing, prompts nothing, and reads no hidden state. AI, state, logging, sources, the cloud, and approval all arrive through ports, so it can run inside any host. Only `presentation` writes human wording; everything else emits codes and data. Which package may depend on which is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#packages).

## Use it as a library

Build a hosted product, an internal platform, an agent, or a CI bot on the same engine the CLI uses.

```ts
import { createHero } from '@hero-cloud/sdk';

const hero = createHero({ ai, state }); // ports are injected: ai, state, locks, secrets, cloud, ...

const analysis = await hero.analyze({ kind: 'directory', location: './my-app' });
const plan = await hero.plan(analysis, { useIdentity: true });

const approval = await myApprovalUi.request(plan); // your system asks a person
if (approval) {
  const result = await hero.deploy(plan, approval, { inputs: { BUDGET_ALERT_EMAIL: email } });
  console.log(result.endpoints, result.health.status); // where it is, and whether it works
}
```

See [`@hero-cloud/sdk`](packages/sdk/README.md), [the engine](docs/ARCHITECTURE.md#the-engine), and [`examples/headless`](examples/headless).

## Develop

Requires Node.js 22.12+ and pnpm 9+. No AWS account or AI key is needed for most work.

```bash
pnpm install
pnpm dev            # public site at http://localhost:4321/aws-hero-cloud/
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Strict TypeScript, Vitest, ESLint, and Prettier. Integration tests against a sandbox AWS account run with `pnpm test:integration`.

## Contributing

Hero Cloud is built in the open and contributions of every size are welcome: code, detectors for new stacks, translations, documentation, accessibility testing, and ideas.

- Browse the [open issues](https://github.com/Alejo2075/aws-hero-cloud/issues), especially [`good first issue`](https://github.com/Alejo2075/aws-hero-cloud/labels/good%20first%20issue) and [`help wanted`](https://github.com/Alejo2075/aws-hero-cloud/labels/help%20wanted).
- Read [Contributing](.github/CONTRIBUTING.md) before opening a pull request.
- A major proposal starts as an issue labeled `rfc`.
- Everyone follows the [Code of Conduct](.github/CODE_OF_CONDUCT.md). Decisions are described in [Governance](.github/GOVERNANCE.md).
- Need help? See [Support](.github/SUPPORT.md).

## Documentation

| Document                                   | What it covers                                        |
| ------------------------------------------ | ----------------------------------------------------- |
| [Product](docs/PRODUCT.md)                 | What Hero is, who it is for, and what you get back    |
| [Architecture](docs/ARCHITECTURE.md)       | The engine, packages, decisions, and dependency rules |
| [Roadmap](docs/ROADMAP.md)                 | What is built and what comes next                     |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Errors, exit codes, and what to do                    |
| [Changelog](CHANGELOG.md)                  | What changed in each release                          |
| [Brand](brand/GUIDELINES.md)               | Logo, palette, and how to use them                    |

## License

Hero Cloud is open source under the [Apache License 2.0](LICENSE). It is sponsored and initially maintained by Cloud Republic, and it is not an AWS reseller or a managed hosting service. Studio's components come from [Pixelact UI](https://pixelactui.com). Amazon Web Services and AWS are trademarks of Amazon.com, Inc.; Hero Cloud is independent and not endorsed by AWS.
