# Hero Cloud web

**Status:** Implemented.

The public Hero Cloud project site is a static Astro application with TypeScript, CSS, and the pixel brand kit. It communicates the open-source engine, its CLI/Core boundaries, the current repository, and the safe path toward future analysis and plan review.

## Development

Requirements: Node.js 22.12+ and pnpm 9+.

```sh
pnpm install
pnpm --filter @hero-cloud/web dev
pnpm --filter @hero-cloud/web build
```

The site is served at http://localhost:4321. The static output is written to `dist/`.

## Boundaries

The page is the public project site, not a hosted deployment service and not the product's interface. The interface where people analyze, review, and deploy is Hero Studio (planned, runs locally), which runs locally. This site must not ask users to paste AWS secrets or AI keys, and it never runs the engine. Anything beyond documentation hands off to `hero-cloud studio` or the CLI on the user's machine.

The repository link is centralized in `src/data/project.ts`. The canonical repository is `Alejo2075/aws-hero-cloud`. `apps/cli` and `packages/core` are currently scaffolds, so the page marks their install status as coming soon and does not invent package commands.
