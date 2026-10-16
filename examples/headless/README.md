# Headless example

`deploy.mjs` analyzes, plans, and deploys a folder using only `@hero-cloud/sdk`. It imports no CLI,
terminal, or presentation code, which shows that the engine can sit behind any product.

`deployFolder(hero, folder, options)` takes a function, `approve(plan)`, where your product shows the
plan to a person. Only a person's agreement may make it return `true`; an AI agent or a script must
never answer for them.

The test `tests/headless.test.ts` runs this file against a fake cloud, so it needs no AWS account.
