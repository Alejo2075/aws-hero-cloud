# Governance

Hero Cloud is an open-source project sponsored and initially maintained by Cloud Republic. Cloud Republic provides stewardship, branding, website hosting, and early engineering, and is not required in the runtime path of the engine.

## Roles

- **Contributors** open issues, pull requests, and RFC comments. Anyone can be one.
- **Maintainers** review and merge, run releases, respond to security reports, and protect the project's principles. Cloud Republic names the initial maintainers.
- **Becoming a maintainer.** Contributors with sustained, high-quality work in an area can be invited by existing maintainers. The goal is a maintainer group that includes people outside Cloud Republic.

## Decisions

- Small changes: a maintainer approves the pull request.
- Significant features, new interfaces, and Hero Spec, SDK, or plugin changes: an issue labeled `rfc` with a public discussion period. Accepted decisions are recorded in [ARCHITECTURE.md](../docs/ARCHITECTURE.md#decisions).
- Decisions are made in public, by consensus among maintainers. If consensus fails, the maintainers vote by simple majority, with the reasoning recorded.

## Principles maintainers protect

- Local-first, user-owned execution: no Hero accounts, hosted service, or default telemetry.
- A person approves every plan; agents never do.
- The engine stays provider-neutral and reusable by third parties.
- Output stays honest at every audience level, and health reports only what was observed.

## Sponsor and neutrality

Cloud Republic's commercial products, if any, are built on the public SDK like anyone else's. Features are not withheld from the open-source engine to favor them.

## Changing governance

Changes to this document go through an `rfc` issue.
