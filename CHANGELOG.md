# Changelog

All notable changes to Hero Cloud are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). The Hero Spec is versioned independently of the software.

## [Unreleased]

### Added

- **`hero-cloud analyze`**: reads a folder, a ZIP, or an https Git repository without running it and says what the application needs, at three levels of detail (`simple`, `guided`, `expert`), in English and Spanish, or as versioned JSON.
- **Sources** (`@hero-cloud/sources`): hardened folder, ZIP, and Git loaders that never follow symlinks, keep secret-looking files out of every snapshot, enforce size and count limits, resist ZIP bombs and path tricks, and pin Git to validated addresses.
- **Analyzer and Node plugin**: deterministic JavaScript and TypeScript detection (Vite, React, Next.js export, Astro, Express, Fastify, Hono, Koa, Hapi, Nest, cron jobs, DynamoDB, SQL, Mongo, Redis, search, S3, uploads, authentication, environment names, monorepos, plain HTML). A `hero.yaml` inside the source is treated as untrusted.
- **Engine core**: sealed plans (RFC 8785 digest including the provider artifact hash), single-use approval challenges, ports for AI, state, plans, secrets, and sources, coded errors, and `createHero()`.
- **Hero Spec v1** as strict Zod schemas with an exported JSON Schema and a safe `hero.yaml` parser.
- **Presentation**: message catalogs with a build gate that fails when any code lacks a message at any level in any locale.
- **`hero-cloud plan`**: a reviewable plan at three levels. The planner chooses the lowest strategy that works (static or serverless today), explains why, applies the person's answers with strict validation, and turns anything it cannot do yet into a blocking warning. The AWS provider maps components to resources with safe defaults (private, encrypted, HTTPS-only, least privilege, backups, a budget alert) and estimates cost from public AWS prices, with a cache and a built-in fallback.
- **AWS provider on the CDK**: plans come from the real synthesized template, validated against the AWS Solutions rules (a violation stops the plan) and listing every resource, helpers included. The plan digest includes the hash of the cloud assembly. A schedule AWS cannot express exactly blocks approval instead of being approximated.
- **Identity**: `hero.identity()` asks STS who the credentials belong to and refuses the account owner; `plan({ useIdentity: true })` plans for that account.
- **Least-privilege bootstrap**: a permission boundary for every role Hero creates and a limited execution policy in place of administrator access, applied by an approved bootstrap.
- **Deployer**: applies a stored assembly after proving its hash, account, and region; the toolkit's confirmations are answered only when the approval covers them. Updates are diffed through CloudFormation change sets, so replacements and deletions are shown as destructive.
- **Safe builds in your account**: Hero generates the buildspec itself (a `buildspec.yml` in the project is never used), shows the install and build commands, the pinned image, and the time limit as part of the plan, and builds in a CodeBuild project whose role can only read the uploaded source and write its artifacts and logs. Source is packed from the reviewed snapshot, each file checked against its recorded hash, with secret-looking files already left out. Start commands travel as base64 so they cannot break out of their line.
- **`hero-cloud deploy`, `health`, `outputs`, `destroy`**: deploy shows the plan and applies it only after a person approves (a prompt, or `--approve <digest>` for scripts). The result says how to reach the app, what was checked and what the checks cannot show, the cost, where to look, and what to do next, at three levels in English and Spanish. Destroy is a plan that needs approval, shows every removal as destructive, and says which data it keeps. Exit code 4 means deployed but not shown to be working.
- **Health from observation only**: stack state, reachability of Hero-created addresses (HTTPS only, no redirects off the host, time and size limits), and smoke paths named by the app. Anything else is not requested.
- Deployments are remembered under `.hero/` (private to the owner); the AWS stack stays the source of truth. A deployment cannot be changed by two runs at once.
- `examples/headless`: deploys using only the SDK.
- Gated integration tests for a real sandbox account (`pnpm test:integration`).
- Plans are bound to the source that was reviewed, and a plan with a blocking warning cannot start an approval.
- Exit code 3 for a plan that exists but cannot be approved yet.
- Seven example applications used as regression fixtures.
- Real tooling: Vitest, strict type-checked ESLint, an architecture test that enforces the package dependency table, CodeQL, dependency review, Scorecard, and actions pinned by commit SHA.

### Changed

- The project is a pnpm workspace of source-first packages; `typescript` is a project dependency instead of a global install.
- The public site no longer advertises commands that do not exist yet.

### Security

- Terminal output strips control characters that come from the analyzed project.
- Git clones resolve the host once, refuse any private address, never follow redirects, and connect only to the validated addresses.
