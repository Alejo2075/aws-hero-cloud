# Roadmap

The path from today's repository (contracts and documents, no behavior) to **Hero 1.0**: the full vision in [PRODUCT.md](PRODUCT.md), working end to end. Any application in (modern, AI-generated, or legacy), deployed to the user's own AWS account after a person approves, proven healthy, and explained at the reader's level, through the SDK, CLI, Studio, MCP, and a desktop app.

How it is built is in [ARCHITECTURE.md](ARCHITECTURE.md). This document says **in what order**, **what "done" means**, and **which known problems each step fixes**.

## How to use this roadmap

- **Built by one person with AI agents.** Phases are sequential and small enough for one person. Each phase ends with something that runs and is released.
- **Each phase has acceptance criteria.** A phase is done when every box is checked, every check passes, and the release is tagged. Not before.
- **Security gates are not optional.** Items marked 🔒 are reviewed line by line by the maintainer, not only by an agent: approval, credentials, IAM, the local server, untrusted input, and secrets.
- **Sizes are rough.** S ≈ 1 week, M ≈ 2 to 3 weeks, L ≈ 4 to 6 weeks of focused solo work with agents. The whole path is roughly **12 to 18 months**. Use the sizes to notice when a phase is going wrong, not as promises.
- **Findings** (`F#` for the current repository, `D#` for the design) are listed in [Known problems](#known-problems) and closed in the phase shown.
- **Decisions** that change a contract start as an issue labeled `rfc` and end as a row in [ARCHITECTURE.md](ARCHITECTURE.md#decisions).

## Milestones

| Version   | Name                     | A person can...                                                                     | Phases |
| --------- | ------------------------ | ----------------------------------------------------------------------------------- | ------ |
| 0.0       | Clean foundation         | Clone a healthy repository whose checks mean something                              | 0      |
| 0.1       | Understands your app     | Run `hero-cloud analyze` on a JS/TS project and read what it needs, at three levels | 1–4    |
| 0.2       | Plans your deployment    | Run `hero-cloud plan` and see a static or serverless AWS plan with cost             | 5      |
| 0.3       | First real deployment    | Deploy a JS/TS app to their own AWS account, built safely, and see it is healthy    | 6–8    |
| 0.4       | Safe to keep running     | Update, roll back, set secrets, and destroy, with guardrails                        | 9      |
| 0.5       | Public alpha             | `npx @hero-cloud/cli`, or embed the published SDK in their own product              | 10     |
| 0.6       | For non-technical people | Use Studio in the browser on their machine, with guided AWS onboarding              | 11–12  |
| 0.7       | Works with your AI       | Drive Hero from their AI assistant (MCP); let a connected AI help analysis          | 13–14  |
| 0.8       | Runs servers             | Deploy containerized and long-running apps with relational databases and storage    | 15     |
| 0.9       | Runs legacy systems      | Deploy PHP, Python, Java, .NET, Ruby, Go, and unclassified apps, or a single VM     | 16     |
| **1.0**   | **Hero**                 | Install a desktop app, drop in any application, approve, and get a working system   | 17–18  |
| after 1.0 | Ecosystem                | Editor extension, CI action, stable plugin SDK, more providers                      | —      |

## Phases

### Phase 0: Clean foundation (S) → 0.0

Make the repository trustworthy before writing engine code.

- [x] `git init`, first commit, and push to `github.com/Alejo2075/aws-hero-cloud`, the canonical repository; confirm the owner account before publishing (F1, F9).
- [x] Remove junk and stubs: `.playwright-mcp/`, `.idea/`, `.pnpm-store/`, `hero-cloud-brand-final.zip`, `turbo.json`, empty `scripts/` `tests/` `examples/` `plugins/`, and the empty stub packages; trim `pnpm-workspace.yaml` (F6).
- [x] Ignore `.claude/settings.local.json`; decide whether `.claude/skills/` belongs in this repository (F2).
- [x] Real tooling: Vitest, ESLint (typescript-eslint, strict), an import-boundary rule enforcing the dependency table (`eslint-plugin-boundaries` or `dependency-cruiser`), `astro check` for the site. `lint` and `test` must fail when they should (F5).
- [x] CI hardening: actions pinned by commit SHA, CodeQL, dependency review, secret scanning and push protection, OpenSSF Scorecard, CODEOWNERS, a real security contact (F8).
- [ ] 🔒 Claim names: create the npm organization `@hero-cloud` and publish a placeholder for the unscoped `hero-cloud` package, which will install the `hero-cloud` binary. Never document the bare `hero`: that npm name belongs to someone else (F4).
- [x] Public site: remove commands that do not exist yet; show "coming soon" and the repository link from `data/project.ts`; delete dead components and duplicate dependencies; align copy with PRODUCT.md (F4, F7).
- [x] Dependency advisory GHSA-ch52-4w7c-c8xp (`http-cache-semantics` via Astro): track the upstream fix, add a pnpm override when one exists, and record the exposure as build-time only (F3).
- [x] **Spikes** (throwaway code, findings written down before Phase 1):
  - [x] CDK Toolkit Library in-process: synthesize to a directory, deploy that exact assembly later without re-synthesizing, intercept every confirmation through `IoHost`, bootstrap with a custom qualifier and a non-admin execution policy (D1, D5, D12).
  - [x] CodeBuild from Node: upload a source zip, run a generated buildspec, stream logs, fetch artifacts (D3).
  - [x] ECS Express Mode from CDK or CloudFormation, versus Fargate with a load balancer (Phase 15).
  - [x] Beginner credentials without long-lived keys: `aws login`, IAM Identity Center, CloudShell hand-off (D11).

**Done when:** a fresh clone passes all checks, CI is green with real lint and tests, the site promises nothing false, and the four spike reports are in `docs/` or in their issues.

### Phase 1: Contracts v1 (S)

Fix the design problems in the contracts before anything depends on them.

- [x] 🔒 Plan digest = SHA-256 of an RFC 8785 canonical JSON of the plan **plus** the provider artifact hash (cloud assembly) **plus** target account and region (D1).
- [x] 🔒 `Approval` gains `expiresAt`, target account, and a nonce. Across process boundaries, doors send a **plan id**; the engine resolves it from its own `PlanStore` and rejects plans it did not produce (D2, D8).
- [x] Error model: `HeroError` with stable codes; every code has messages at three levels later.
- [x] Ports: `SourceLoader`, `PlanStore`, `SecretSink`, `ChallengeStore` (`CloudProvider` and `BuildRunner` are defined with the packages that implement them, in phases 5 to 7, because their shape depends on the planner).
- [x] Hero Spec v1 as Zod schemas, exported as JSON Schema; safe YAML parsing (core schema, size and depth limits) for `hero.yaml`.
- [x] Contract tests and type tests; ARCHITECTURE.md updated.

**Done when:** the contracts compile, are tested, and every D-finding assigned here is closed in the docs.

### Phase 2: Sources (M)

- [x] 🔒 Local directory: canonical paths, symlinks never followed outside the root, ignore lists (`node_modules`, `.git`, build output), file count and size limits.
- [x] 🔒 ZIP: reject traversal, absolute paths, and symlink entries; limits on entries, total size, and compression ratio (zip bombs) (D10).
- [x] 🔒 Git: HTTPS only, depth 1, no submodules, no hooks, no LFS smudge, `core.symlinks=false`, `protocol.file.allow=never`, timeouts, minimum safe `git` version or a pure-JS client (D10).
- [x] A read-only snapshot model (file index with hashes) that the analyzer and builds consume.
- [x] A fixture corpus of malicious archives and repositories, run in CI.

**Done when:** the malicious corpus is rejected, and folder, ZIP, and Git sources of the same app produce the same snapshot hash.

### Phase 3: Deterministic analyzer for JS/TS (M)

- [x] Detectors written against the plugin interface from day one: `package.json`, lockfiles, React, Vite, Next.js static export, Express, Fastify, Hono, Node version, `.env.example`, AWS SDK imports, ports, health routes.
- [x] Evidence and confidence on every detection; open questions instead of guesses.
- [x] Output: Hero Spec + `Analysis`.
- [x] 🔒 A `hero.yaml` found inside the repository is **untrusted**: validated, compared with the analysis, and every field it adds is flagged for review. Only a spec the user supplies from outside the source skips analysis (D4).
- [x] `createHero()` with injectable ports; `examples/headless` runs `analyze` with only the SDK.
- [x] Examples: seven small JS/TS apps (static site, SPA, SPA + API, API only, API + key-value data, scheduled job, monorepo), each with a reviewed `expected.json` checked by `tests/examples.test.ts`.

**Done when:** every example produces the expected Hero Spec, and `examples/headless` works.

### Phase 4: Presentation and first CLI (M) → 0.1

- [x] `presentation`: presenter, message catalogs (English and Spanish), `simple`, `guided`, `expert`, fallback rules, a renderer-neutral `View`.
- [x] A check that fails CI when any code lacks a message for one of the three levels.
- [x] CLI: `hero-cloud analyze` with `--level`, `--locale`, `--json`; terminal renderer.
- [x] Snapshot tests for every example at every level and locale.

**Done when:** `hero-cloud analyze` on each example reads well at all three levels in both languages (checked by running the real bundled binary on every example, level, and language). **Release 0.1.**

### Phase 5: Planner for static and serverless (M) → 0.2

- [x] Strategy selection (`static`, `serverless`) with rationale codes and evidence.
- [x] Provider-neutral components → AWS mapping interface (implemented in Phase 6).
- [x] Required inputs, warnings, blocking open questions; deterministic output.
- [x] Cost model: public AWS Price List data (no credentials needed) cached locally, with built-in fallback prices, confidence, and assumptions (D14).
- [x] `hero-cloud plan`, rendered at three levels.

**Done when:** each example yields a stable plan and cost estimate, and identical inputs give an identical digest. **Release 0.2.**

### Phase 6: AWS provider and CDK foundation (L)

- [x] 🔒 Credentials: the AWS SDK default chain, profiles, SSO; `sts:GetCallerIdentity` to show the account and refuse root (D15).
- [x] 🔒 Hero bootstrap as an approved plan of its own: CDK bootstrap with a `hero` qualifier and a **least-privilege execution policy instead of the default administrator policy**, plus a permission boundary that every role Hero creates must carry (D5).
- [x] CDK construct library (internal to `providers/aws`): static site (S3 with CloudFront origin access control), HTTP API with Lambda, DynamoDB, Cognito, tags `hero:deployment-id`, budget alert, backups.
- [x] `cdk-nag` (AwsSolutions) and template snapshot tests on every construct.
- [x] 🔒 Synthesize once to a stored cloud assembly; the plan digest includes its hash; deploy uses that assembly and never re-synthesizes; `IoHost` rejects any confirmation not covered by the approval (D1, D12).
- [x] Diff through CloudFormation change sets, so `replace` and destructive changes are real, not guessed (D8).
- [ ] An isolated sandbox AWS account with a budget for integration tests; every test run destroys what it creates.

**Done when:** each serverless example synthesizes, passes cdk-nag, and deploys and destroys cleanly in the sandbox account (with prebuilt artifacts; builds come next).

_Status: implemented and unit-tested with mocks (`pnpm test`). The sandbox-account run lives in `tests/integration/` and needs `HERO_INTEGRATION=1` plus credentials for an isolated account; it has not been run yet, so the "deploys and destroys cleanly" bar is open._

### Phase 7: Safe builds in CodeBuild (M)

- [x] 🔒 Builds run only in AWS CodeBuild in the user's account. Hero generates the buildspec; a buildspec from the repository is never used (D3).
- [x] 🔒 The build commands, runtime image, and timeout are part of the plan and the approval.
- [x] 🔒 The CodeBuild role can read its source and write its artifacts and logs, and nothing else; the user's credentials never enter the build.
- [x] Source upload excludes `.env*`, keys, and other secret-looking files, and the plan says so.
- [x] Artifacts: Lambda bundles to S3 (finished static sites ship as they are; images to ECR arrive in Phase 15). Build progress is reported as events; build logs stay in the user's CloudWatch.

**Done when:** examples build in CodeBuild with no local Node, Docker, or credentials exposed to project code.

_Status: implemented and unit-tested with mocks. Running a real build in CodeBuild needs the sandbox account (`tests/integration/`)._

### Phase 8: Deploy, health, and outputs (M) → 0.3

- [ ] `hero-cloud deploy` with an interactive approval; `--approve <digest>` for scripts.
- [ ] Health checks derived from the Hero Spec: `reachability`, `resource-state`, `smoke`.
- [ ] 🔒 Smoke paths must be paths, not URLs; requests go only to Hero-created endpoints; redirects off-host refused; timeouts and size limits (D7).
- [ ] `DeploymentResult` with endpoints, health, links, cost, and next steps; `hero-cloud health`, `hero-cloud outputs`, `hero-cloud destroy` (destroy is a plan).
- [ ] Local `StateStore` under `.hero/`; the AWS stack is the source of truth.
- [ ] `examples/headless` deploys end to end using only the SDK.

**Done when:** every JS/TS example goes from folder to healthy URL to clean destroy in the sandbox account, at all three levels. **Release 0.3.**

### Phase 9: Updates, secrets, and guardrails (M) → 0.4

- [ ] Update and redeploy through change sets; destructive changes and replacements shown at every level; rollback on failure.
- [ ] 🔒 Secrets: values are entered in a hidden prompt and written straight to SSM Parameter Store (SecureString) or Secrets Manager; never CloudFormation parameters, logs, events, or `.hero/` (D6).
- [ ] Data protection: deletion policies (snapshot or retain) for databases and buckets, backups on by default.
- [ ] A budget alert with an email address the user enters (stored only in their AWS account) (D14).
- [ ] A per-deployment lock against concurrent deploys from two doors; drift detection on `hero-cloud health`.

**Done when:** an update that would replace a table is shown as destructive and refused without explicit approval, and a secret never appears in any log or file. **Release 0.4.**

### Phase 10: Publish the SDK and CLI (M) → 0.5

- [ ] API review of the SDK; API Extractor report checked in CI.
- [ ] Compiled `dist/` and `exports` for published packages; Changesets; npm provenance; SBOM; signed tags.
- [ ] 🔒 Install-size budget for the CLI (CDK is heavy; measure and trim) (D12).
- [ ] Docs: quick start, SDK guide, troubleshooting, the public site updated with real commands.

**Done when:** `npx @hero-cloud/cli analyze` works from npm on macOS, Linux, and Windows, and a third party can embed `@hero-cloud/sdk`. **Release 0.5 (public alpha).**

### Phase 11: Local server and Studio (L) → 0.6 (part 1)

- [ ] 🔒 Local server: loopback on a random port; a one-time code in the opened URL exchanged for an `HttpOnly`, `SameSite=Strict` cookie; Host and Origin checks; CSRF protection; no wildcard CORS; server-sent events (D9).
- [ ] 🔒 Plans and approvals cross the boundary as ids and nonces only (D2).
- [ ] Studio (React, served by the local server): choose a folder or ZIP, review the plan at a level, approve, enter secrets, watch progress, see health.
- [ ] Accessibility (WCAG 2.2 AA) and both languages.

**Done when:** a person who never opened a terminal (after `hero-cloud studio`) deploys an example and understands the result at `simple`.

### Phase 12: Guided AWS onboarding (M) → 0.6

- [ ] Detect existing credentials and explain what was found.
- [ ] 🔒 For people with none: the path chosen in the Phase 0 spike, with no long-lived keys and no Hero-hosted template (quick-create links need a template in S3, which Hero cannot host) (D11).
- [ ] Create the least-privilege deployer role from Phase 6 and switch to it.
- [ ] Explain AWS account creation and billing honestly (Hero cannot do that for anyone).

**Done when:** a beginner with only an AWS account and a browser reaches a healthy deployment. **Release 0.6 (beta for non-technical people).**

### Phase 13: MCP server (M)

- [ ] Tools: `hero_analyze`, `hero_plan`, `hero_explain`, `hero_request_deploy`, `hero_outputs`, `hero_health`, `hero_plan_destroy`. **No approve tool.**
- [ ] 🔒 `hero_request_deploy` returns a pending request; the person approves in Studio or a terminal using a nonce the agent never sees (D2).
- [ ] 🔒 Source roots limited to an allowlist; evidence carries file paths, never contents; secret-looking files never read (D13).
- [ ] Repository-derived text is marked as untrusted data in every tool result; progress notifications.
- [ ] Tested with at least two MCP clients.

### Phase 14: AI providers and AI-assisted analysis (M) → 0.7

- [ ] Adapters: Anthropic, OpenAI, Amazon Bedrock, Ollama, OpenAI-compatible.
- [ ] 🔒 Consent screen and record; context minimization; secret redaction before sending; token and cost limits.
- [ ] AI may only fill or refine the Hero Spec. Its output is schema-validated and never chooses AWS resources or permissions.
- [ ] An evaluation set of ambiguous apps and a prompt-injection corpus, run in CI with a local model or recorded responses.

**Done when:** an app the deterministic analyzer cannot classify gets a correct spec with AI, the result is marked `aiAssisted`, and the injection corpus changes nothing. **Release 0.7.**

### Phase 15: Container strategy (L) → 0.8

- [ ] Strategy `container`: an existing Dockerfile, or an image built with Cloud Native Buildpacks in CodeBuild when there is none.
- [ ] ECR, and ECS Express Mode or Fargate with a load balancer (per the Phase 0 spike).
- [ ] Relational data: RDS PostgreSQL and MySQL with backups and private networking; file-system storage on EFS.
- [ ] Health from load balancer target health plus reachability.

**Done when:** an Express app with PostgreSQL, a Django app, and a Dockerfile-only app deploy and report healthy. **Release 0.8.**

### Phase 16: Legacy detectors and the virtual-machine strategy (L) → 0.9

- [ ] Detectors: PHP (plain, Laravel, WordPress), Python (Flask, Django, FastAPI), Java (Spring Boot, WAR), .NET, Ruby (Rails), Go, static HTML, `Procfile`, and `process` services for anything else.
- [ ] Strategy `virtual-machine` (Lightsail or EC2, decided by a spike): setup script shown in the plan and approved, 🔒 access through SSM Session Manager instead of open SSH, snapshots, a stable address.
- [ ] Unsupported-application report: local, redacted, structure and manifests only, sent only if the user chooses.
- [ ] Examples corpus extended with real legacy fixtures (with permission) and their expected specs.

**Done when:** at least one app per listed stack deploys and reports healthy, and an unknown app produces a useful report instead of a wrong plan. **Release 0.9.**

### Phase 17: Desktop app and installers (M)

- [ ] A desktop wrapper around Studio (Tauri or Electron, decided by size and security), drag and drop a folder or ZIP.
- [ ] 🔒 Code signing and notarization (macOS), signing (Windows); auto-update with signed releases.
- [ ] Homebrew formula and a single-file installer.

### Phase 18: Release candidate (M) → 1.0

- [ ] 🔒 Threat model reviewed against the built system; external security review; fuzzing of sources and the local server.
- [ ] Failure drills: failed builds, failed deploys, interrupted deploys, expired credentials, rollback.
- [ ] Cost estimate accuracy checked against real bills in the sandbox account.
- [ ] Documentation complete for all three audiences; translations reviewed by native speakers.
- [ ] Every finding in [Known problems](#known-problems) closed or explicitly accepted.

**Done when:** a non-technical person installs the desktop app, drops in an application from the examples corpus, approves, and gets a working, healthy system they understand, and an engineer can audit every resource that was created. **Release 1.0.**

### After 1.0

Editor extension, CI action (plan on pull request, deploy behind environment approval), a stable public plugin SDK, more sources (GitLab, Bitbucket, S3), more providers, and the long-term direction below.

## Known problems

Found by analyzing the repository and the design on 2026-10-15. Each one is closed in the phase listed.

### In the current repository

| ID  | Severity | Problem                                                                                                                                                                                                                                              | Phase |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| F1  | High     | The project is not a Git repository: no history, no recovery, CI and Dependabot inert. A folder (`brand/`) was emptied during this session with no record of how.                                                                                    | 0     |
| F2  | Medium   | `.claude/settings.local.json` is not ignored. It holds absolute personal paths and another project's names, and would be published.                                                                                                                  | 0     |
| F3  | High     | `pnpm audit`: GHSA-ch52-4w7c-c8xp in `http-cache-semantics` ≤ 4.2.0 through Astro 7.3.5; no patched version yet. Exposure is build-time for a static site, but it must be tracked.                                                                   | 0     |
| F4  | High     | The public site tells visitors to run CLI commands (`init`, `analyze`, `plan`, `deploy`) that do not exist yet. The npm name `hero` belongs to an unrelated maintainer and `@hero-cloud` is unclaimed: an install-confusion and name-squatting risk. | 0     |
| F5  | Medium   | `lint` and `test` are `echo` placeholders and the site has no typecheck, so green CI proves almost nothing.                                                                                                                                          | 0     |
| F6  | Medium   | Docs say only four packages exist, but twelve empty stubs, `turbo.json` (unused), empty folders, and local junk remain.                                                                                                                              | 0     |
| F7  | Low      | Site: unused components and dependencies, no link to the repository, copy describes an older vision.                                                                                                                                                 | 0     |
| F8  | Low      | CI actions pinned to tags, not SHAs; no CodeQL, dependency review, secret scanning, or CODEOWNERS; no security contact.                                                                                                                              | 0     |
| F9  | Low      | The repository was renamed to `aws-hero-cloud`; the GitHub repository must be created or renamed to match, and the owner account confirmed.                                                                                                          | 0     |

### In the design

| ID  | Severity | Problem                                                                                                                                                                                        | Phase     |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| D1  | Critical | The approval binds to the plan summary, not to what is actually deployed (synthesized templates, assets). What runs could differ from what was approved.                                       | 1, 6      |
| D2  | High     | An `Approval` is plain data any caller can build. "Agents never approve" is only a door convention; over the local server or MCP a client could send a fabricated plan with a matching digest. | 1, 11, 13 |
| D3  | Critical | Deploying requires building untrusted code (install scripts, build commands), which the design did not cover; it only forbade execution during analysis.                                       | 7         |
| D4  | High     | A `hero.yaml` inside a repository could dictate the spec, including build commands and public exposure, and skip analysis.                                                                     | 3         |
| D5  | High     | Deploying functions and containers needs role creation and `iam:PassRole`, a classic privilege-escalation path. Default CDK bootstrap also grants CloudFormation administrator access.         | 6         |
| D6  | High     | The path of secret values from the person to the running app was not designed; plaintext CloudFormation parameters, logs, or local state could leak them.                                      | 9         |
| D7  | Medium   | `healthPath` comes from an untrusted repository; smoke checks could be aimed at metadata or internal addresses (SSRF).                                                                         | 8         |
| D8  | Medium   | The account can change between plan and deploy (drift, manual edits), so an approved plan may no longer describe the real change.                                                              | 6, 9      |
| D9  | Medium   | A session token in the URL fragment can leak through history, screenshots, or shared links.                                                                                                    | 11        |
| D10 | Medium   | Cloning untrusted repositories has had remote-code-execution bugs (submodules, symlinks, hooks); ZIPs need zip-bomb limits, not only traversal checks.                                         | 2         |
| D11 | Medium   | CloudFormation quick-create links need a template in S3, but Hero has no hosting by design, so the planned beginner onboarding cannot work as written.                                         | 0, 12     |
| D12 | Medium   | CDK in-process is heavy to install, and its own confirmation prompts must never bypass Hero's approval.                                                                                        | 6, 10     |
| D13 | Medium   | An agent could point analysis at sensitive folders; file names and evidence would flow into the agent's context and possibly a remote model.                                                   | 13        |
| D14 | Low      | Cost data needs AWS credentials or cached tables; budget alerts need an email address that must stay in the user's account.                                                                    | 5, 9      |
| D15 | Low      | Root-account credentials must be detected and refused explicitly.                                                                                                                              | 6         |
| D16 | Medium   | Two doors could deploy the same project at once without a lock.                                                                                                                                | 9         |

## Working with AI agents

- One phase at a time. Break it into issues small enough for one agent session, each with tests that define done.
- Agents follow [CLAUDE.md](../CLAUDE.md). The maintainer reviews every 🔒 change personally and runs it against the sandbox account.
- Tests come first for contracts, sources, approval, and anything 🔒.
- The sandbox AWS account is separate from anything personal or production, has a budget alarm, and is cleaned automatically.
- Each phase ends with a release, an updated CHANGELOG, and docs that match the code.

## Testing strategy

| Layer             | What                                                                         | When                       |
| ----------------- | ---------------------------------------------------------------------------- | -------------------------- |
| Unit and contract | Vitest; type tests for the SDK                                               | Every PR                   |
| Snapshot          | Hero Spec per example, plans, views at three levels, synthesized templates   | Every PR                   |
| Security          | Malicious source corpus, cdk-nag, prompt-injection corpus, local server fuzz | Every PR (fuzz nightly)    |
| Integration       | Deploy, health, update, destroy in the sandbox account                       | Nightly and before release |
| End to end        | `examples/headless`, CLI, Studio (Playwright), MCP clients                   | Before release             |

## Long-term direction

Same philosophy, wider reach:

- **Sources:** Local, ZIP, Git, GitHub, GitLab, Bitbucket, S3, APIs, AI agents.
- **Frameworks (via plugins):** React, Vite, Next.js, Astro, SvelteKit, Express, FastAPI, Django, Spring, and legacy stacks.
- **AWS capabilities:** Lambda, API Gateway, S3, CloudFront, DynamoDB, Cognito, EventBridge, SQS, SNS, Step Functions, Aurora and RDS, ECS and Fargate, and more through providers.
- **Interfaces:** CLI, SDK, Studio, MCP, VS Code, CI, desktop, and third-party products.

The aim is not "a tool that deploys a Vite app". It is a reusable open-source engine that turns application intent into safe, reviewable cloud infrastructure, and a base for developer tools, agents, internal platforms, and commercial products.

## Where to help

| Area                                         | Good for                                        | From phase |
| -------------------------------------------- | ----------------------------------------------- | ---------- |
| Example apps, especially old or messy ones   | Anyone; they become test fixtures               | 3          |
| Detectors for a framework or legacy stack    | Developers who know a stack                     | 3          |
| Translations of the output messages          | Anyone bilingual                                | 4          |
| Plain-language (`simple`) wording            | Writers and non-experts reading with fresh eyes | 4          |
| Planner rules, AWS constructs, health checks | Cloud engineers                                 | 6          |
| Studio, MCP                                  | Interface developers                            | 11         |

See [CONTRIBUTING.md](../.github/CONTRIBUTING.md).
