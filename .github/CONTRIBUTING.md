# Contributing to Hero Cloud

Thank you for helping. Hero is built in the open and designed so you can contribute without understanding the whole system. If you are unsure where to start, open an issue and ask.

## Where to help

| You can...                                                                 | Where                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------- |
| Report an app Hero could not understand or deploy                          | New issue                                       |
| Add an example app, especially an old or messy one                         | `examples/`                                     |
| Teach Hero a framework or legacy stack                                     | detectors in `packages/analyzer` and `plugins/` |
| Improve a planner rule or health check                                     | `packages/planner`, `packages/providers/aws`    |
| Translate output messages or improve the plain-language (`simple`) wording | `packages/presentation`                         |
| Improve docs                                                               | `docs/`                                         |
| Review a pull request or RFC                                               | GitHub                                          |

Look for `good first issue` and `help wanted`. Other labels: `core`, `analyzer`, `planner`, `aws`, `ai`, `plugin`, `presentation`, `studio`, `mcp`, `documentation`, `rfc`.

## Where things live

Read [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md#packages) first. In short: interfaces call the SDK, wording lives in `presentation`, AWS details live in the AWS provider, and `core` knows nothing about any of them. Each package README says what it is for and whether it exists yet.

## Set up

Node.js 22.12+ and pnpm 9+. No AWS account or AI key is needed for most work.

```bash
pnpm install
pnpm dev
```

## Before a pull request

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- Keep it focused and say why.
- Add tests, and update docs for any change to the SDK, Hero Spec, plugins, analyzer, planner, or deployment.
- A new rationale, warning, event, or check code needs messages for `simple`, `guided`, and `expert`.
- Never include credentials, API keys, customer source, or real account IDs in code, fixtures, logs, or issues.

## Changes and releases

A change that people who install Hero would notice needs a changeset: run `pnpm changeset` and describe it in a sentence a user can understand. If you change the public API of `core` or `sdk`, run `pnpm api:update` and commit the updated `api/*.api.md`; CI fails when the report and the code disagree. After adding or changing a published package, run `pnpm release:prepare`.

Maintainers release by running `pnpm version-packages`, committing, and pushing a signed tag `vX.Y.Z`. The release workflow checks, builds, publishes with provenance, and attaches a software bill of materials. All published packages share one version.

## Decisions

Open an issue labeled `rfc` for a significant feature, a new interface, or a change to the SDK, Hero Spec, or plugin contracts. When it is accepted, the decision is added to [ARCHITECTURE.md](../docs/ARCHITECTURE.md#decisions). Small fixes need no RFC. How maintainers decide is in [GOVERNANCE.md](GOVERNANCE.md).

## Security, conduct, license

Report vulnerabilities privately ([SECURITY.md](SECURITY.md)). Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md). The project is Apache 2.0; by contributing you agree your work is provided under that license.
