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
