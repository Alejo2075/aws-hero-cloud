# Hero Cloud: working guide

Hero takes any application, plans a deployment to the user's own AWS account, and after a person approves, deploys it and proves it works. It runs locally with the user's AWS and optional AI. Read [docs/PRODUCT.md](docs/PRODUCT.md) (what and for whom) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how) before changing architecture, public APIs, or product wording. Those documents are the source of truth; this file is the short version.

## Repository state

Pre-alpha. Code that exists is contracts and types, with no behavior yet: `packages/core`, `packages/specification`, `packages/sdk`, `packages/presentation`, plus the public site in `apps/web`. Other packages named in the docs (`analyzer`, `planner`, `deployment`, `sources`, `providers/*`, `apps/cli`, `apps/studio`, `server`, `mcp`, ...) are planned and get created when first implemented; follow [docs/ROADMAP.md](docs/ROADMAP.md).

## Commands

Node 22.12+, pnpm 9+, strict TypeScript with `noUncheckedIndexedAccess`.

```bash
pnpm install
pnpm dev              # public site (apps/web)
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build   # run before handing off
```

`lint` and `test` are still placeholders in most packages; add real ones with real code.

## Boundaries

- **The engine is headless and separate.** `sdk`, `core`, `specification`, the stages, and providers form a library other systems build on. It never imports a door, `presentation`, `local`, or the website; it prints nothing, prompts nothing, and reads no ambient state. Everything it touches arrives through ports (`HeroPorts`: AI, state, logger, source, cloud, approval). `examples/headless` (planned) must work with only the SDK.
- **SDK is the single door.** Every interface (CLI, Studio, local server, MCP, editors, third-party products) depends on `@hero-cloud/sdk` (plus `presentation` for words) and contains no planning, analysis, or AWS logic.
- `core` owns the public contracts and knows nothing about any interface or provider.
- The **analyzer** reports provider-neutral needs with evidence and confidence, for any application including legacy ones. The **planner** chooses the strategy (`static`, `serverless`, `container`, `virtual-machine`). Only `providers/aws` knows AWS and CloudFormation.
- AI sits behind `AIProvider`. It is optional and never required for deterministic analysis.
- **Only `presentation` writes human wording.** Everything else emits codes and data. Allowed dependency directions are in [ARCHITECTURE.md](docs/ARCHITECTURE.md#packages).
- `apps/web` is the public site. It never runs the engine and never receives credentials or keys.

## Rules that must hold

- **A person approves; an agent never does.** `deploy` needs an `Approval` bound to the plan digest. There is no approve tool in MCP.
- **Levels are views.** `simple`, `guided`, and `expert` read the same data. Never hide a cost, a destructive change, a warning, the approval step, or the limits of a health check at any level. A new rationale, warning, event, or check code ships with messages for all three levels.
- **Health states only what was observed.** Never report "working" beyond what a check showed.
- **Local-first.** Do not add accounts, a hosted service, or default telemetry.
- **Safety.** Never log or commit AWS credentials, AI keys, environment secrets, or source contents. Plans, results, and events carry names and locations of secrets, never values. Treat Git repositories and ZIPs as untrusted and never run project code during analysis. Make destructive changes visible. Deploy only an approved plan.
- Keep public contracts small and provider-neutral. Add tests and docs with any change to the SDK, Hero Spec, plugins, analyzer, planner, or deployment.
- A foundational decision gets a row in [ARCHITECTURE.md](docs/ARCHITECTURE.md#decisions); a major proposal starts as an issue labeled `rfc`.

## Style

Match the surrounding code. Keep comments to the non-obvious why. Prefer readonly types and small interfaces. Prettier config is at the root.
