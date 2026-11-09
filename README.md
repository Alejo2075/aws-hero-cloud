<p align="center">
  <img src="./brand/hero-cloud-logo.gif" alt="Hero Cloud" width="420" />
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
  <a href="docs/PRODUCT.md">Product</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href=".github/CONTRIBUTING.md">Contributing</a>
</p>

Hero Cloud is a free, open source tool that takes an application of any age or origin, works out what it needs, plans how to run it on AWS, and shows you the plan. After **you** approve that exact plan, it deploys and checks that the result works. It runs on your own computer, with your own AWS account and, optionally, your own AI. There is no Hero account, no hosted service, and nobody in the middle.

```text
Your app ─► Understand ─► Plan ─► You approve ─► Deploy to your AWS ─► Health check ─► Link, status, cost
```

## Features

- **Any application:** Node, Python, PHP, Ruby, Go, Java, .NET, containers, static sites, and legacy stacks.
- **Simplest fit on AWS:** static, serverless, or container, chosen for you with the reasons.
- **Cost before you commit:** a monthly range, never a single promise.
- **A person approves:** nothing is created until you approve the exact plan. An AI assistant can never approve.
- **Proof, not promises:** health checks say what was observed and what they do not cover.
- **Three levels:** `simple`, `guided`, and `expert` show the same data at the depth you need, in English and Spanish.
- **Local-first:** no accounts, no telemetry, and secrets are never stored in plans or logs.
- **Many ways in:** command line, Studio (a local web interface), an AI assistant over MCP, or the SDK.

## Install

Needs Node.js 22.12+. Analyzing and planning need no AWS account.

```bash
npx @hero-cloud/cli analyze ./my-app
```

## Usage

```bash
npx @hero-cloud/cli analyze ./my-app     # what your app needs
npx @hero-cloud/cli plan ./my-app --offline --account-id 123456789012   # a plan and a cost range
npx @hero-cloud/cli studio               # the same flow in your browser, on your machine
```

To deploy to your own account, sign in to AWS the usual way (a profile, SSO, or environment variables; never the account owner). `npx @hero-cloud/cli setup` checks your sign-in and what is missing.

```bash
npx @hero-cloud/cli deploy ./my-app      # shows the plan; creates nothing until you approve it
npx @hero-cloud/cli health hero-my-app   # proof it works, and what that proof does not cover
npx @hero-cloud/cli destroy hero-my-app  # remove it (data is kept until you delete it)
```

Add `--level guided` or `--level expert` for more detail and `--locale es` for Spanish. Something went wrong? See [Troubleshooting](docs/TROUBLESHOOTING.md).

## Use it as a library

The engine is headless and separate from every interface, so you can build your own product, internal platform, agent, or CI bot on it.

```ts
import { createHero } from '@hero-cloud/sdk';

const hero = createHero({ ai, state }); // ports are injected

const analysis = await hero.analyze({ kind: 'directory', location: './my-app' });
const plan = await hero.plan(analysis, { useIdentity: true });

const approval = await myApprovalUi.request(plan); // your system asks a person
if (approval) {
  const result = await hero.deploy(plan, approval);
  console.log(result.endpoints, result.health.status);
}
```

See [`@hero-cloud/sdk`](packages/sdk/README.md) and [the engine](docs/ARCHITECTURE.md#the-engine).

## Repository

```text
apps/cli                  The hero-cloud command line
apps/studio               Studio, the local web interface
apps/web                  Public project site
packages/sdk              Stable API; the single door into Hero
packages/core             Public contracts and engine orchestration
packages/analyzer         Provider-neutral needs, with evidence and confidence
packages/planner          Strategy, plan, and cost range
packages/providers/aws    AWS and CloudFormation
packages/providers/ai     Optional AI providers
packages/mcp              MCP server for AI assistants
packages/server           The local server behind Studio
plugins/                  Stack plugins
examples/                 Sample applications
docs/                     Product, architecture, and roadmap
```

Which package may depend on which is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#packages).

## Develop

Requires Node.js 22.12+ and pnpm 9+. No AWS account or AI key is needed for most work.

```bash
pnpm install
pnpm dev            # public site at http://localhost:4321
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Contributing

Issues, ideas, and pull requests are welcome. Read [Contributing](.github/CONTRIBUTING.md) first; larger proposals start as an issue labeled `rfc`. Report vulnerabilities privately as described in [Security](.github/SECURITY.md).

[Code of Conduct](.github/CODE_OF_CONDUCT.md) · [Governance](.github/GOVERNANCE.md) · [Support](.github/SUPPORT.md)

## License

[Apache 2.0](LICENSE). Sponsored and initially maintained by Cloud Republic. Hero Cloud is not an AWS reseller or a managed hosting service.
