# Changelog

All notable changes to Hero Cloud are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Hero Spec versions independently of the software.

## [Unreleased]

### Added

- Local-first, any-application, one-engine-many-doors architecture.
- Public contracts in `@hero-cloud/core`: `Hero`, `DeploymentPlan`, `Approval`, `DeploymentResult`, `HeroEvent`, and `AudienceLevel`.
- Draft Hero Spec v1 types, including legacy `process` services, relational data, and file-system storage.
- Packages `presentation`, `local`, `server`, `mcp`, and the `studio` app as scaffolds.
- Architecture docs for interfaces, audience-level presentation, the local runtime, and deployment strategies.
- Community files: support policy, issue and pull request templates, CI workflow.

### Changed

- Project definition amended (Amendment 1); MVP, roadmap, vision, principles, and threat model updated.
- `typescript` is now a project dependency instead of relying on a global install.
