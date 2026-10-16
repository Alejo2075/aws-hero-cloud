# Core

**Status:** Implemented (contracts only).

Engine orchestration and the public contracts every other package shares: `Hero`, `DeploymentPlan`, `Approval`, `DeploymentResult`, `HeroEvent`, and `AudienceLevel`. Coordinates sources, analyzer, Hero Spec, planner, deployment, and providers through interfaces.

Keep it independent of CLI, Web, Studio, and every other interface. It also defines the ports a host replaces (`AIProvider`, `StateStore`, `Logger`). It contains no human-readable wording: it emits codes, and the optional [`@hero-cloud/presentation`](../presentation) turns them into text.

Third-party products normally depend on [`@hero-cloud/sdk`](../sdk), not on this package.
