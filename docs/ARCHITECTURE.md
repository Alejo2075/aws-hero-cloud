# Architecture

How Hero is built. For what it does and for whom, see [PRODUCT.md](PRODUCT.md); for the order we build it in, [ROADMAP.md](ROADMAP.md).

## Overview

```text
 PRODUCTS     Your own SaaS, internal platform, agent, bot, migration tool ...
 DOORS        CLI │ Studio │ MCP │ Editor │ CI          (render, ask, and collect approval)
 PRESENTATION Output levels and locales                  (optional; turns codes into words)
 ─────────────────────────────────────────────────────────────────────────────────────
 ENGINE       Hero SDK                                   the only way in
 (headless)     └─ Core: contracts and orchestration
                  └─ Source → Analyzer → Hero Spec → Planner → Deployment Plan
                       └─ Approval (supplied by the host, bound to the plan digest)
                            └─ Deployment → AWS provider → the user's AWS account
                                 └─ Deployment result: endpoints, health, links, cost
```

Four ideas hold it together:

1. **One engine, many doors.** Every interface is an adapter over the SDK and contains no business logic.
2. **Local-first.** Hero runs on the user's machine with their AWS and AI. No Hero service exists.
3. **Plan, then a person approves, then apply.** Nothing is created outside the approved plan.
4. **Producers emit data and codes; only `presentation` writes words.** That is how one plan reads at three levels.

## The engine

The engine is the part of Hero that takes an **input** (a folder, ZIP, or repository), understands it with deterministic analysis and, if the host supplies one, an AI, plans a deployment, and, once the host passes a person's approval, deploys it to AWS and proves it works. It is a **headless library**. It is separate from every interface on purpose, so that other systems can be built on it.

```text
      input  ──►  [ ENGINE ]  ──►  plan, result, health, events   (plain data)
                     ▲
        ports: AI · state · logger · source · cloud · approval handler
```

**What the engine is:** `sdk` (the API), `core` (contracts and orchestration), `specification`, the stages (`sources`, `analyzer`, `planner`, `deployment`), and the provider and plugin packages it is given.

**What it is not:** a CLI, a web app, a server, an MCP server, a prompt, a renderer, or a product. Those are doors and products that sit on top.

**Guarantees an embedder can rely on:**

- **Headless.** No console output, prompts, `process.exit`, browser APIs, or reading of the terminal. Progress is `HeroEvent`s; diagnostics are structured `Logger` entries.
- **Everything arrives through ports.** AI, state storage, logging, source loading, and the cloud provider are injected. The engine reads no hidden global state and no ambient environment; credentials come from the standard AWS chain or a provider the host passes in.
- **No words.** It returns data and codes. Wording is the optional `presentation` package, which the engine does not import.
- **No identity.** No accounts, tenants, billing, or telemetry. A host that has them adds them outside the engine.
- **Safe to run many at once.** No singletons; each `Hero` instance is independent, so a host can run one per user, project, or request.
- **Approval is supplied, never assumed.** `deploy` needs an `Approval` bound to the plan digest. The host decides how a person is asked.
- **Works without Cloud Republic.** No Hero service is called, and nothing requires the website.

**What you can build on it:** a hosted deployment service with its own accounts and billing, an internal developer platform, an AI coding agent that ships what it writes, a CI bot that comments plans on pull requests, a migration tool for legacy estates, an editor plugin, or a different cloud's deployment tool by swapping the provider. Cloud Republic's own CLI, Studio, and MCP server are built the same way as any of these.

**How the separation is kept:**

- Engine packages cannot import doors, `presentation`, or `local` (checked by the dependency table below and, once code exists, by a lint rule).
- The SDK is the only public entry. Doors and products import `@hero-cloud/sdk`, never `core` or a stage directly.
- An example product that uses **only** the SDK and no door code (`examples/headless`) is a required deliverable of phases 1 and 3, so the claim stays tested.
- Anything a door needs that the SDK does not offer is added to the SDK, not worked around.

## Packages

Dependencies point down; a package never imports from a row above it.

| Layer          | Packages                                                                   | May depend on                                      |
| -------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| Products       | Anything built on Hero, including third-party systems                      | `sdk`, optionally `presentation`                   |
| Doors          | `apps/cli`, `apps/studio`, `packages/server`, `packages/mcp`, future doors | `sdk`, `presentation`, `local`                     |
| Presentation   | `presentation`                                                             | `core` types only                                  |
| Local runtime  | `local`                                                                    | `core` types, `presentation` types                 |
| **Engine API** | `sdk`                                                                      | `core`, `specification`, stages, default providers |
| **Engine**     | `core`                                                                     | `specification`, `shared`; defines the ports       |
| **Stages**     | `sources`, `analyzer`, `planner`, `deployment`                             | `core` contracts, `specification`, `shared`        |
| **Edges**      | `providers/aws`, `providers/ai`, `plugins/*`                               | `core` contracts, `specification`, `shared`        |
| Foundations    | `specification`, `shared`, `plugin-sdk`                                    | nothing else in the repo                           |

Bold rows are the engine. No bold row may import a non-bold row above it.

**Exist today** (contracts and types only): `core`, `specification`, `sdk`, `presentation`, and `apps/web` (the public site). Everything else is planned and is created when first implemented.

Rules:

- The engine never depends on a door, Studio, the CLI, `presentation`, `local`, or the website.
- The analyzer states **needs** ("relational data, writable disk"), never AWS resources. The planner chooses the strategy. Only `providers/aws` knows AWS and CloudFormation.
- `apps/web` documents the project. It never runs the engine and never receives credentials or keys.
- Internal packages expose `src/index.ts` as their entry point while they are private, so consumers type-check against source. Publishing adds a compiled `dist/` as release work.

## Core contracts

Defined in `packages/core` and re-exported by `packages/sdk`.

```ts
interface Hero {
  analyze(source, options?): Promise<Analysis>; // Hero Spec + detections + open questions
  plan(analysis, options?): Promise<DeploymentPlan>; // sealed: has a digest, stored by the engine
  requestApproval(plan: PlanRef): Promise<ApprovalChallenge>; // one-time challenge, for the door facing a person
  deploy(plan: PlanRef, approval): Promise<DeploymentResult>; // applies exactly the approved plan
  planDestroy(deploymentId): Promise<DeploymentPlan>; // all deletions; needs approval too
  outputs(deploymentId): Promise<DeploymentResult>; // endpoints, health, links, cost
  health(deploymentId): Promise<Health>; // re-run the checks
  subscribe(listener): () => void; // HeroEvent progress
}
```

- **Analysis**: the Hero Spec, detections with evidence and confidence, open questions for the person, and whether an AI contributed (`aiAssisted`).
- **DeploymentPlan**: a _sealed_ plan. Target (provider, region, account), strategy, changes (each with action, capability, resource, a `destructive` flag, and rationale codes with evidence), warnings, required inputs (names only), cost estimate, and the **artifact hash**. Its `digest` is the SHA-256 of the RFC 8785 canonical JSON of all of that, and its `id` derives from the digest, so neither can be chosen by a caller. Because the artifact hash is inside the digest, approving a plan approves exactly the synthesized artifacts that will be applied.
- **Approval**: not a flag a caller can set. The engine issues a one-time **challenge** for a plan it produced and keeps only a hash of its secret nonce. A door shows the plan to a person and, only when they agree, turns the challenge into an approval. `deploy` takes a **plan reference** (id and digest), resolves the real plan from the engine's own store, and accepts the approval only if the challenge is live and unused and the digest, account, and region all match. A fabricated plan, a guessed nonce, a replay, an expired approval, or an approval for another account is refused with a coded error. The nonce goes to the door facing the person, never to an AI agent.
- **DeploymentResult**: endpoints, **health**, resources, locations of sensitive outputs, operation links, cost, next steps. No secret values.
- **Health**: overall and per-component status plus the checks behind it (`reachability`, `resource-state`, `smoke`), each with what was observed. Re-runnable through `Hero.health`.
- **HeroEvent**: progress as codes, for any interface.

Third parties supply their own `ApprovalHandler`, `StateStore`, `PlanStore`, `SecretSink`, `SourceLoader`, `AIProvider`, `Logger`, and cloud provider through `HeroPorts`. The cloud provider and build runner ports are defined with the packages that implement them. The engine's defaults never contact a Hero service.

## Hero Spec

The provider-neutral contract between understanding an application and choosing infrastructure. It never names cloud resources. Versioned independently of Hero; the types are in `packages/specification` and v1 is a draft.

```yaml
version: '1'
application: { name: store }
frontend: { framework: vite, build: { command: npm run build, output: dist } }
services:
  - { id: api, type: http, runtime: nodejs }
data:
  - { id: products, type: key-value }
environment: [API_SECRET]
```

The spec is saved as `hero.yaml` next to the project. A user or another system can provide a valid one directly and skip source analysis. A service may declare an optional `healthPath` that Hero uses as a smoke check. Legacy and unclassified workloads use `type: process` services (runtime, start command, port), `relational` data with an `engine` hint, and `file-system` storage. They describe needs; the planner decides whether they imply a container or a virtual machine.

## Sources

A source turns untrusted input into a **snapshot**: a read-only index of files with sizes and SHA-256 hashes, whose own hash depends only on content. A folder, a ZIP, and a Git checkout of the same files have the same snapshot hash. Everything downstream (analysis, builds, AI context) consumes snapshots, never the origin.

Rules every source follows:

- **No symlink is ever followed.** Symlinks, devices, and pipes are left out and reported. Each read re-checks the file against its hash and refuses a file that changed or was swapped for a link after loading.
- **Secrets never enter a snapshot.** Environment files with values, private keys, token files, and state files are left out and reported by name only. `.env.example` is kept because it holds names, not values. So a secret cannot reach the analyzer, a build upload, or an AI.
- **Bounded.** Limits on file count, file size, total size, path length, and depth, enforced while reading.
- **ZIP:** the whole index is validated before anything is written: no traversal, absolute or drive paths, backslashes, symlinks or special files, encryption, or paths that collide on case-insensitive disks; a compression-ratio limit; and the bytes actually written are counted, because an archive can lie about its sizes. A single project root folder, as in a GitHub archive, is stripped.
- **Git:** HTTPS only, no credentials in the URL, no private or local hosts. The host name is resolved once, refused if **any** address is private, loopback, link-local, carrier-grade NAT, or IPv4-mapped, and git is pinned to the validated addresses so a second lookup cannot redirect it (DNS rebinding). Redirects are never followed. A shallow clone with no hooks, submodules, LFS filters, symlinks, prompts, or user and system configuration, a minimal environment that carries none of the user's secrets, a timeout, and a minimum Git version. Committed symlinks are detected and left out.
- Temporary files are removed on `dispose` and on any failure.

## Analyzer

Answers "what does this application need to run?" without executing it. It works in layers and degrades gracefully:

1. Known stacks through framework detectors (plugins), with high confidence.
2. Known runtimes by manifests and conventions (`package.json`, `requirements.txt`, `composer.json`, `pom.xml`, `Dockerfile`, `Procfile`, ports, database drivers).
3. Unknown or legacy: a `process` service with the best-supported runtime, port, and start command, each with confidence.
4. AI-assisted interpretation when the user connected an AI. Output is schema-validated and marked `aiAssisted`.
5. Anything still uncertain becomes an **open question** for the person instead of a guess.

Detectors are plugins (`DetectorPlugin` in `plugin-sdk`). The official JavaScript and TypeScript detectors live in `plugins/node`, one file per concern: runtime, front end, server, scheduled jobs, data, storage, authentication, environment, monorepo, plain static sites, and unrecognized projects. Each returns detections, contributions to the Hero Spec, and open questions; the analyzer merges them deterministically, so the result does not depend on detector order. A detector that throws or hangs cannot break the analysis: it is reported as a question and the rest continues.

Evidence is a short reference (`dependency:express`, `file:vite.config.ts`, `script:start`), never a copy of file contents, so evidence is safe to show to an AI or an agent.

**A `hero.yaml` inside the source is untrusted.** It can ask for build commands or public exposure, so it is never applied. It is validated, compared with what analysis found, and every field analysis did not confirm becomes a question for a person. A spec is used as written only when the user supplies it from outside the source (`AnalyzeOptions.spec`), and even then it is validated.

Every detection carries evidence and a confidence value, which is what lets a reviewer see why a plan was produced:

```json
{
  "capability": "key-value-data",
  "confidence": 0.98,
  "evidence": ["Dependency @aws-sdk/client-dynamodb", "DynamoDBClient imported in src/db.ts"]
}
```

Deterministic facts never need AI: a `vite` dependency means Vite, route files mean an API, AWS SDK imports mean infrastructure, `.env.example` means required environment variables. AI is for ambiguous code, unusual frameworks, and missing context.

## Planner and strategies

The planner picks the lowest strategy that satisfies the Hero Spec (`static`, `serverless`, `container`, `virtual-machine`), moves up only when a capability demands it, and records each decision as a rationale code with evidence. Example mappings: static front end to S3 and CloudFront, HTTP Node service to API Gateway and Lambda, key-value data to DynamoDB, authentication to Cognito.

Rules: the same inputs produce the same plan and digest; every create, update, replace, and delete is listed; cost is an estimate with confidence and assumptions; by default the plan includes a budget alert and backups for stateful resources; unanswered open questions block the plan; IAM is least-privilege.

A plan reads like this, shown at the `guided` level:

```text
HERO DEPLOYMENT PLAN                         Region: us-east-1   Strategy: serverless
Estimated cost: $8 to $15 a month (medium confidence)

Create
+ CloudFront distribution   serves your website worldwide
+ S3 bucket                 stores the built website
+ API Gateway + Lambda      runs your API (Node.js)
+ DynamoDB table            stores "products" (your code uses key-value access)

Modify / Delete             none
Warnings                    2 environment variables needed: API_SECRET, DB_NAME
```

At `simple` each line is one sentence with no service names; at `expert` it adds resource types, settings, and evidence.

`static` and `serverless` ship first; `container` and `virtual-machine` follow (see [ROADMAP.md](ROADMAP.md#milestones)), each with an `rfc` issue before implementation.

**What the planner does and does not do.** It is a pure function from an analysis and the person's answers to a provider-neutral set of _components_ (`static-site`, `http-service`, `scheduled-job`, `key-value-table`, `object-bucket`, `identity`, `budget-alert`), a strategy with its reason, the inputs a person must supply (names only; secrets are told apart from settings), and warnings. A provider then turns components into its own resources through `CloudProvider.describe`, adds the safeguards Hero always applies, estimates cost, and returns the hash of what it would apply. The engine seals all of it, including the **source hash**, so approving a plan approves exactly the code that was reviewed.

What Hero cannot do yet is a _blocking warning_, never a guess: relational and document databases, caches, search, local-disk storage, continuously running programs, and runtimes other than Node.js all need `container` and produce a plan with no changes. A plan with a blocking warning cannot start an approval. Open questions either block (the person must answer or fix the project) or advise; an answer is validated strictly, because it ends up in commands and settings, and an answer to a question that does not exist is refused so a typo is never silently ignored.

**Cost.** An estimate is a range from a nearly idle application to a busy small one, with its assumptions listed as codes. Unit prices come from the public AWS Price List files, which need no account or credentials: a fresh local cache, then a live download of the few small files Hero needs (validated, size- and time-limited, from one host over HTTPS), then prices built into Hero. Each product is matched by an exact usage type, because variants such as infrequent-access tables or replica writes have different prices. The estimate says where its prices came from and is never above `medium` confidence, since usage cannot be known beforehand. `--offline` never touches the network.

## Deployment and health

The deployment engine applies an approved plan through a provider. The AWS provider builds a CDK app **in process** and drives it with the CDK Toolkit Library; CDK and CloudFormation concepts stay behind the provider boundary.

- **The approved artifact is the synthesized cloud assembly.** The provider synthesizes once, stores the assembly, and includes its hash in the plan digest. Deploy uses that stored assembly and never re-synthesizes. Every confirmation the toolkit raises is rejected unless the approval already covers it.
- **Real diffs.** Updates are computed with CloudFormation change sets, so replacements and destructive changes come from AWS, not from guesses.
- **Least-privilege bootstrap.** Hero bootstraps each account and region with its own qualifier and a restricted execution policy (never the default administrator policy), and every role Hero creates carries a permission boundary. Bootstrapping is itself a plan that needs approval.
- **Builds never run on the user's machine.** Installing and building the application means running untrusted code, so it happens only in AWS CodeBuild in the user's account. Hero generates the buildspec (a repository's own buildspec is never used), the commands are part of the plan and the approval, and the build role can read its source and write its artifacts, nothing else. The user's credentials never enter the build.
- **Secrets go straight to their store.** Values a person enters are written to SSM Parameter Store or Secrets Manager and referenced at runtime. They are never CloudFormation parameters, logs, events, or local state.

- Creates nothing outside the plan. Resources are tagged `hero:deployment-id`, so update and destroy are exact.
- Destroy is a plan like any other and needs approval.
- Idempotency, updates, rollback, and safe failure are designed in; drift awareness comes later.
- **Health** is how Hero proves a deployment works. Checks are derived from the Hero Spec, so they match the system that was deployed:

| Component in the spec                                | Check Hero runs                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Frontend                                             | `reachability`: the public URL answers with a success status; latency recorded |
| HTTP service                                         | `reachability`: the service URL (or its `healthPath`) answers                  |
| Data store                                           | `resource-state`: the provider reports it available                            |
| Object or file storage                               | `resource-state`: the bucket or volume exists and is in use                    |
| Auth                                                 | `resource-state`: the identity pool or service is active                       |
| Worker or scheduled job                              | `resource-state`: the function, task, or schedule is enabled                   |
| Any component with a `healthPath` or user-named path | `smoke`: that request succeeds                                                 |

Each check is `passed`, `failed`, or `skipped` (with a reason), and component and overall status are `healthy`, `degraded`, `down`, or `unknown`. A deployment that creates resources but fails its checks is reported as such. Hero states what it observed, such as "the page answered in 0.4 s" or "the database is available". It does not claim the application's logic is correct, and it says which things it did not check.

### Provider notes

What the phase 0 research established. These came from AWS documentation, not from a live account, and the integration tests will confirm them.

- **CDK Toolkit Library** (`@aws-cdk/toolkit-lib`) runs synth, deploy, diff, rollback, and destroy in process. `synth` returns a cloud assembly that later actions reuse without re-synthesizing, and the default deployment method uses CloudFormation change sets. Hotswap is never used: it introduces drift.
- **`destroy` does not ask for confirmation** in the library (the CLI does). Hero therefore runs it only for a destroy plan that a person approved.
- **Bootstrap** accepts a custom qualifier and custom CloudFormation execution policies, so Hero bootstraps with its own qualifier and a restricted policy instead of the default administrator policy.
- **ECS Express Mode** exists as the CloudFormation resource `AWS::ECS::ExpressGatewayService`: a Fargate service with load balancer, security groups, auto scaling, and a URL. It is the default for the `container` strategy, with plain Fargate behind a load balancer as the fallback when a workload needs more control.
- **Beginner credentials:** `aws login` gives short-term credentials from console sign-in (valid 15 minutes, refreshed automatically for up to 12 hours) without creating access keys. It also accepts the root user, so Hero checks `sts:GetCallerIdentity` and refuses a root identity.
- **CodeBuild:** a build starts with an S3 source override and an inline buildspec override that Hero generates, reports status by polling, writes logs to CloudWatch Logs, and delivers artifacts to S3.

## Output levels

Presentation is outside the engine and optional: a product that only wants data ignores it. `simple`, `guided`, and `expert` are views of the same data, each containing the previous. [PRODUCT.md](PRODUCT.md#what-you-get-back) defines what each shows.

```text
Plan / Result / Health  (codes + parameters + evidence)
        │
        ▼
   Presenter  ◄── MessageCatalog (locale, level)
        │
        ▼
      View   (title, sections, blocks)   renderer-neutral
        │
        ▼
  Renderer: terminal │ Studio │ Markdown │ chat reply
```

- Producers emit **codes**, never sentences. `presentation` maps codes to text per level and locale. A code is a message key: `error.<code>`, `question.<code>`, `capability.<name>`, `evidence.<kind>`, with `evidence.<kind>.<value>` for specific pieces of evidence.
- **Completeness is enforced.** Producers publish their codes (`errorCodes`, the question codes of the analyzer and of each plugin, the standard capabilities, the evidence kinds). `tests/messages.test.ts` fails the build if any code lacks a message at any of the three levels in any shipped locale, and if a catalog still holds a message for a code that no longer exists. The catalogs must define the same codes and the same placeholders in every language.
- A new rationale, warning, event, or check code ships with messages for all three levels in the same change.
- Costs, destructive changes, warnings, required inputs, approval, and the limits of the checks appear at every level. Hiding them to look simpler is a bug.
- Adding a language is a message catalog, not a code change. Output is deterministic and snapshot-tested.
- If the user has an AI, a door may offer to rephrase a view for a particular reader. The AI sees the built view, never the source, and the deterministic view remains what was approved.
- The level is a user setting, default `simple`, overridable per command and switchable in Studio. Hero does not guess expertise. `--json` and the SDK return the data itself.

## Doors

Doors parse input, call the SDK, and render through `presentation`. They add no planning, analysis, AWS behavior, or approval logic. Each lets the person choose a level and locale, reports progress through `HeroEvent`, and offers stable JSON.

| Door         | Notes                                                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI          | `hero-cloud analyze / plan / deploy / health / destroy`, plus `hero-cloud studio` and `hero-cloud mcp`. Non-interactive deploys need `--approve <digest>`. |
| Studio       | `hero-cloud studio` serves a local web app on loopback: import a folder or ZIP, connect AWS, review, approve, see health. Not the public site.             |
| Local server | JSON and server-sent events over the SDK, for Studio and editors.                                                                                          |
| MCP server   | Tools: `hero_analyze`, `hero_plan`, `hero_explain`, `hero_request_deploy`, `hero_outputs`, `hero_health`, `hero_plan_destroy`. **No approve tool.**        |
| Later        | Editor extension, CI action (plan on PR, deploy behind an environment approval), desktop wrapper for people who avoid terminals.                           |

**CLI.** The binary is `hero-cloud`. Today it has `analyze <source>` and `plan <source>` (with `--answer question=answer`, `--region`, `--account-id`, and `--offline`); `deploy`, `health`, `outputs`, and `destroy` arrive with their phases, and later `validate`, `diff`, `doctor`, `plugins`. Every command accepts `--level simple|guided|expert` (or `HERO_LEVEL`), `--locale` (or the system language), and `--json`, which prints a stable, versioned document (`schema: 1`) to stdout. Results go to stdout; progress and errors go to stderr; exit code 0 is success, 1 is a failure, 2 is a mistake in the command line, and 3 means a plan was made but has a blocking issue, so it cannot be approved yet. Usage errors still honour the requested level and language. Technical detail (`HERO_DEBUG=1`) is opt-in, and an error's cause is never printed because it may hold secrets.

**Terminal safety.** Text that comes from the analyzed project (dependency names, paths, spec values) is untrusted, and printed raw it could carry escape sequences that rewrite the screen or write to the clipboard. The CLI replaces control characters before printing, and the Node detectors do not echo version ranges that are not plainly ranges.

```text
$ hero-cloud analyze ./my-app
✓ React detected   ✓ Vite detected   ✓ Node API detected   ✓ Object storage required
Generated hero.yaml

$ hero-cloud plan
+ S3   + CloudFront   + API Gateway   + Lambda
Deploy this plan? [y/N]
```

**Reaching people who avoid terminals** happens in stages: `npx` anywhere Node runs, then a single-file install (Homebrew or a signed installer) that opens Studio, then a desktop wrapper around Studio where you drop a folder or ZIP. These are packaging over Studio, not new engines.

**Approval is the security boundary.** Only a door that shows the plan to a person may create an `Approval`: a terminal prompt, Studio, an MCP confirmation the person answers, or a host product's own UI. An AI agent, script, or tool call never approves itself, so a repository that prompt-injects an assistant still cannot trigger a deployment.

**Local server hardening:** loopback binding on a random port, never `0.0.0.0`; a random per-session token on every request, not persisted; `Host` and `Origin` validation against DNS rebinding and cross-site requests; no wildcard CORS; no secrets in responses; an OpenAPI description.

A new door needs an `rfc` issue and must follow the rules above.

## Local runtime

```text
 User's machine
 ┌──────────────────────────────────────────────┐
 │ Door ─► SDK ─► Engine                        │
 │                  │         │                 │
 │          AI provider     AWS provider        │
 └──────────────────┼─────────┼─────────────────┘
                    ▼         ▼
          User's AI service   User's AWS account
```

No Hero or Cloud Republic service is in this path.

**AWS.** Hero uses the standard credential mechanisms and never asks the user to type long-lived keys into Hero: an existing profile or SSO session, environment or execution-role credentials (CloudShell, CI, EC2/ECS roles), or, for beginners, a guided one-time setup. In the guided setup Hero produces a CloudFormation quick-create link that the user opens in their own console to create a **least-privilege deployer role** that Hero then assumes; no key is created or pasted. Hero refuses root-account credentials, reads credentials at the moment of use, keeps them in memory only, and never logs them.

**AI.** Optional; `--no-ai` always works. Local models (Ollama) send nothing out. Remote providers use the user's key from an environment variable or the OS keychain, never a config file. Before the first remote call for a project Hero shows what would be sent (file names, snippets, or full files), lets the person narrow it, redacts secrets, and records the consent.

**Configuration** holds references, never secrets: the AWS source (profile, SSO, role), the AI selection (none, local, or remote with the name of the env var or keychain entry), default region, audience level, and locale.

**State.** Kept on the user's machine behind a `StateStore` interface: `.hero/` in the project and a user config directory. No central database and no telemetry by default (any opt-in diagnostics would need an RFC and never include source, credentials, or environment values). The AWS stack is the source of truth for what exists.

## AI providers

AI is a replaceable, user-supplied provider behind one interface, not a hosted service:

```ts
interface AIProvider {
  generate<T>(request: AIRequest): Promise<T>;
}
```

Adapters: Anthropic, OpenAI, Amazon Bedrock, Ollama (local), and any OpenAI-compatible endpoint. Keys come from the caller (the CLI reads a named environment variable); Hero never stores them.

How AI is allowed to help:

- **Only when the person agrees.** The engine contacts a model only if a model is configured _and_ a consent scope (`file-names`, `snippets`, or `full-files`) was granted. The CLI shows what will be sent and to whom, and records the decision in `.hero/`. A model on this computer needs no consent.
- **Only what is needed.** Context is built from file names and, if allowed, short pieces of manifests and entry files. Files that look like secrets are never included, and everything is redacted for keys, tokens, private keys, and credentials in addresses before it is sent. Calls, context size, output size, and estimated cost are capped per run.
- **Only to fill gaps.** The model is asked for a small, fixed shape (what kind of program, runtime, port, health path, schedule, kind of data, framework of a website). It can add what the deterministic analysis did not find; it cannot change or remove anything found, name commands, addresses, secrets, permissions, or cloud resources. Every value is checked against a pattern and the result must be a valid Hero Spec, or the whole answer is discarded.
- **Visible.** The analysis is marked `aiAssisted`, each filled field carries `ai:` evidence, and a notice says how much was sent and how much was redacted. If the model is unavailable or misbehaves, analysis continues without it.
- Project text is treated as data in the prompt, and a corpus of prompt-injection fixtures runs in CI against recorded worst-case answers.

## Extension points

`SourcePlugin`, `DetectorPlugin`, `PlannerPlugin`, `AIProviderPlugin`, `DeploymentProviderPlugin`, and `LocalePlugin` (message catalogs). A plugin that adds a code provides its messages for all three levels. Surfaces are small, so a newcomer can add a detector, a planner rule, a translation, or an example app without understanding the whole system.

```ts
export default definePlugin({
  detectors: [...],
  planners: [...],
  validators: [...],
});
```

Official plugins will live in `plugins/` and start with React, Vite, Node runtime, DynamoDB, S3, Cognito, and API on Lambda. Astro, SvelteKit, FastAPI, Redis, SES, or a legacy stack should be addable without touching the core.

## Public site

`apps/web` is the project's front door: landing, documentation, and open-source discovery. It does not require an account and never receives AWS keys or AI keys, because a public page must not ask people to paste long-lived secrets. Anything beyond reading hands off to local tools: `hero-cloud studio`, the CLI, or AWS CloudShell, where execution happens in the user's own environment. Cloud Republic may host the site; it never hosts customer infrastructure or the engine. The site must make clear that Hero is infrastructure tooling, not an AWS reseller or managed hosting.

## Engineering baseline

TypeScript in strict mode with `noUncheckedIndexedAccess`; pnpm workspaces; Prettier today, with Vitest, ESLint, and Zod (or an equivalent runtime schema validator) to be added with the first real code; GitHub Actions running install, format check, lint, typecheck, tests, and build on every pull request. Most tests need no AWS credentials: they use fixtures, synthesized templates, and `cdk-nag`. Integration tests run in an isolated sandbox account. Versions follow Semantic Versioning, released with Changesets once packages are published. The Hero Spec has its own version, separate from package versions, and a breaking change to the SDK or the Hero Spec needs documentation and migration notes.

## Security

Hero processes untrusted sources, holds AWS access and AI keys while it runs, and can create infrastructure. It runs locally, so the user's machine is the trust boundary. Assumptions: that machine is not already compromised, AWS and the chosen AI provider are trusted with what the user sends them, and a person is present at approval.

| Threat                                              | Mitigation                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious ZIP, path traversal, unsafe symlinks      | Safe extraction into an isolated directory; reject links and paths that escape                                                              |
| Malicious project code or package lifecycle scripts | Nothing in the project executes during analysis                                                                                             |
| Prompt injection in source or tool results          | Repository text is data, never instructions; AI output is advisory until schema and planner validation; MCP marks repository text untrusted |
| **An AI agent deploys without a person**            | No approve tool; `deploy` needs an `Approval` bound to the digest, created only by a door that shows a person the plan                      |
| **Local server abused by a web page or process**    | Loopback only, per-session token, Host and Origin checks, no wildcard CORS                                                                  |
| **Source or secrets sent to a remote AI**           | Optional AI; local models; minimized and redacted context; recorded consent                                                                 |
| Credential leakage                                  | Standard AWS mechanisms; memory only; never logged; root refused; keys in env or keychain                                                   |
| Secrets in plans, results, state, events            | Plans hold input names; results hold locations; nothing holds values                                                                        |
| AI-generated unsafe infrastructure, broad IAM       | Planner validation; least-privilege deployer role with a permission boundary; broad policies flagged                                        |
| Destructive changes                                 | `destructive` flag at every level; delete and replace need approval; destroy is a plan                                                      |
| A simple view hides risk                            | Cost, destructive changes, warnings, and approval appear at every level; snapshot-tested                                                    |
| A "working" claim the checks do not support         | Health reports only observed facts and the limits of each check                                                                             |
| Unexpected spend                                    | Cost in every plan; default budget alert; tags for exact teardown                                                                           |
| Exposed legacy workloads                            | Public exposure stated plainly; unsafe defaults flagged; backups for stateful resources                                                     |
| Supply chain                                        | Pinned lockfile, minimal dependencies, reviewed updates                                                                                     |
| Unsupported-app report leaks code                   | Local, redacted, structure and manifests only, sent only if the user chooses                                                                |

A change that adds an input, a network path, a permission, or a data flow must update this table. Report vulnerabilities as described in [SECURITY.md](../.github/SECURITY.md).

## Decisions

Foundational decisions are recorded here. A significant proposal starts as an issue labeled `rfc`; once accepted, add a row.

| Decision                                                                                                            | Why                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Monorepo with explicit package boundaries                                                                           | The engine, spec, interfaces, providers, and docs evolve together                                 |
| Plan before apply; an approved plan is the only boundary to mutation                                                | No unreviewed infrastructure changes                                                              |
| Local-first, no accounts, no hosted service, no default telemetry                                                   | Credentials and source stay with the user; nothing to breach or bill                              |
| The SDK is the single door; interfaces are adapters                                                                 | One behavior everywhere; third parties get the same power                                         |
| The engine is a headless library, separate from every door and from presentation                                    | Other systems can be built on it; the official CLI, Studio, and MCP are just the first            |
| Output levels are views of one plan; wording lives in `presentation`                                                | A simple plan can never diverge from what is deployed; translations are catalogs                  |
| Strategy ladder: `static`, `serverless`, `container`, `virtual-machine`                                             | Serves legacy systems without dropping the low-burden default                                     |
| Result centers on health evidence, not only endpoints                                                               | People need to know the system works, at their own level                                          |
| Internal packages are source-first until first publish                                                              | Fast cross-package typechecking                                                                   |
| Repository `aws-hero-cloud`; CLI binary and unscoped npm package `hero-cloud`; scoped packages under `@hero-cloud/` | One name everywhere; avoids the unrelated `hero` npm package                                      |
| AWS CDK in process (CDK Toolkit Library), approval bound to the cloud assembly                                      | Mature constructs behind the provider boundary, and the approved artifact is exactly what deploys |
| Builds run only in AWS CodeBuild in the user's account, with a generated buildspec                                  | Untrusted code never runs on the user's machine or sees their credentials                         |
| Hero 1.0 delivers the full vision, built by one maintainer with AI agents in sequential phases                      | Defined in ROADMAP.md, with acceptance criteria and security gates per phase                      |
