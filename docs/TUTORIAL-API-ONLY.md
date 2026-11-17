# Tutorial: read your first plan with `examples/api-only`

Hero answers three questions before it creates anything: **what does my application need?**, **what
would Hero create?**, and **what would it cost?** This tutorial walks all three on the smallest
serverless example in the repository, then shows the same answer at the `simple`, `guided`, and
`expert` levels.

Nothing here needs an AWS account, an AI key, or network access: `analyze` reads the folder without
running it, and `plan --offline` works with the prices built into Hero.

## The example

[`examples/api-only`](../examples/api-only) is a small Express API:

```js
const express = require('express');

const PORT = process.env.PORT || 3000;
const app = express();

app.get('/healthz', (_req, res) => {
  res.send('ok');
});

app.get('/hello', (_req, res) => {
  res.json({ message: 'hello' });
});

app.listen(PORT);
```

Two routes: `/healthz`, which Hero uses as the health path, and `/hello`. `package.json` declares
`express` and `"start": "node src/server.js"`.

The folder is also a regression fixture: `tests/examples.test.ts` analyzes every example on each CI
run and compares the result with its `expected*.json`. `examples/api-only/expected.json` records the
analysis quoted below, so this walkthrough describes output the test suite already asserts.

## Step 1 — `analyze`: what does my application need?

```bash
hero-cloud analyze examples/api-only
```

If you are working from a checkout of this repository, `pnpm install && pnpm build` once and use
`node apps/cli/dist/hero-cloud.js` in place of `hero-cloud`; once `@hero-cloud/cli` is published,
`npx @hero-cloud/cli analyze examples/api-only` runs the same command.

Hero loads the folder as untrusted data and never executes it. At the default `simple` level it
reports one thing to know: your application looks like this, and one of its parts is an **http
service**. The part comes from evidence, not from a guess about the folder name:

- `src/server.js` listens with `app.listen(PORT)` on `process.env.PORT || 3000`, so Hero records
  port `3000`;
- the `/healthz` route becomes the health path;
- `package.json` provides the start command `npm start` and the `express` dependency;
- the `node-runtime` capability is detected alongside `http-service`.

`examples/api-only/expected.json` pins the result: application `hero-example-api`, one service with
`id: api`, `type: http`, `runtime: nodejs`, `start.command: npm start`, `port: 3000`,
`healthPath: /healthz`, and `questions: []`. An empty question list is the good case — Hero knows
enough to plan.

Every part also carries a **confidence** and the **evidence** behind it. The `guided` and `expert`
levels print the whole table, and `--json` gives you the same data for a script.

When Hero cannot tell something it asks instead of guessing. In `packages/planner/src/policy.ts`,
an unknown start command, an unknown schedule, an unknown database engine, or a monorepo with no
package chosen is a **blocking** question: the plan stops (exit code `3`) until you answer, and the
command line tells you how. Questions that only need your attention — an unknown port, for example —
become a warning instead.

## Step 2 — `plan`: what would Hero create?

```bash
hero-cloud plan examples/api-only --offline --account-id 123456789012
```

`--offline` keeps the command off the network. `--account-id` names the account the plan is written
for; the quick start in the project README uses a placeholder (`123456789012`) when you only want to
read the plan. Leave it out and an offline plan is only a preview: the command exits `3` and says so,
because an approval has to be bound to a real account.

The plan picks the lowest strategy that fits (`strategyFor` in `packages/planner/src/planner.ts`):

- a container when something needs one — a web service that is not Node, a relational database, or a
  writable file system;
- otherwise `static` when every part is a static site;
- otherwise `serverless`.

A Node API needs none of the container cases, so `api-only` is planned as `serverless`: one Lambda
function behind an HTTP API. There is no server to patch, and an idle month costs almost nothing.

The plan then lists, in sections:

- **Summary** — the application, the strategy, and that nothing has been created yet.
- **What will be created** — every AWS resource with a one-line reason: the function, its IAM role
  and permission, the HTTP API with its integration, route, and stage, a log group, and the budget
  guardrail every deployment receives (`monthlyLimitUsd: 10`, alert at 80%). The resource settings
  section shows the values Hero will use: runtime, memory, port, and health path.
- **What you need to provide** — none for this example, because it reads no environment variables.
  Secrets are listed by name and stored encrypted in your own account; their values never appear in
  plans, results, or logs.
- **What it should cost** — the range described in the next step.
- **Good to know** — warnings. A public HTTP service is reachable from the internet, which is
  expected here and is called out rather than hidden.
- **Why each change** and **Seal** — the rationale behind each resource and the digest of the plan.

That digest is the point of the design: an approval is bound to the exact plan, so a plan cannot
change after you approve it, and an AI assistant cannot approve on your behalf.

## Step 3 — the cost range

Hero gives a range because the real number depends on traffic nobody can know before deploying.
`packages/providers/aws/src/cost.ts` states its assumptions instead of hiding them:

| Volume | Requests per month | Time per request | What it represents |
| ------ | ------------------ | ---------------- | ------------------ |
| `low`  | 1,000              | 0.1 s            | a nearly idle app  |
| `high` | 1,000,000          | 0.25 s           | a busy small app   |

The estimate multiplies those volumes by the price book in `packages/providers/aws/src/prices/book.ts`
(public on-demand prices for `us-east-1`, published 2026-10-13) and then subtracts the always-free
allowances — 1,000,000 Lambda requests, 400,000 GB-seconds, and 5 GB of log ingest per month.

For `api-only` that gives three lines:

- **API Gateway HTTP API requests** — `$0.00` when idle, `$1.00` at a million requests a month;
- **function compute** — `$0.00` at both ends: 50 GB-seconds when idle and 125,000 GB-seconds when
  busy, both inside the always-free allowance at 512 MB of memory on ARM;
- **logs** — `$0.00` when idle, `$0.03` at a gigabyte of ingest.

So the total is about **$0.00 to $1.03 a month**, and the plan says so. The `simple` wording shortens
it once the high end stays under a dollar: an estimate whose high end is below `$1` reads "it should
cost almost nothing: less than $1.00 a month" rather than a range.

The estimate also says where its prices came from. With `--offline`, the built-in table is used and
the estimate is marked **low confidence**; a live price lookup marks a serverless estimate **medium
confidence**, and any estimate containing containers stays low, because container prices are built
in and vary by region.

## Step 4 — the same answer at three levels

Levels are views over the same data: they change how much is explained, never the facts, the costs,
or the warnings (`packages/presentation/src/audience.ts`).

| Question            | `simple`                                                                                                 | `guided`                                                                                | `expert`                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| What was analyzed?  | "Your application, hero-example-api, looks like this:"                                                   | "hero-example-api is made of the parts below. Each one says why Hero thinks so."        | "hero-example-api: components in the Hero Spec: 1."                            |
| What is the plan?   | "Hero can put hero-example-api online on your own AWS account. Nothing has been created yet."            | "Hero planned hero-example-api for your AWS account using the \"serverless\" approach." | "hero-example-api: strategy=serverless, account=…, region=…."                  |
| What does it cost?  | "It should cost about $0.00 to $1.03 a month."                                                           | "Expected cost: about $0.00 to $1.03 a month, from nearly idle to busy."                | "monthly $0.00 to $1.03 (low confidence)"                                      |
| Is it working?      | "Working. Every check Hero ran passed."                                                                  | "Healthy: every check that ran passed."                                                 | "healthy"                                                                      |
| What is not proven? | "This shows what Hero can see from the outside. It cannot tell whether every feature of your app works." | "These checks look at the setup and at public addresses from outside."                  | "External observation only: stack state, reachability, and named smoke paths." |

Use them with a flag:

```bash
hero-cloud analyze examples/api-only --level guided
hero-cloud plan examples/api-only --offline --account-id 123456789012 --level expert
hero-cloud plan examples/api-only --offline --account-id 123456789012 --locale es
```

`simple` is the default and is written for someone who has never used AWS; `guided` is for someone
who knows a little; `expert` is for engineers who want ARNs, digests, and codes. Cost, destructive
changes, and the approval step are shown at every level.

## Step 5 — what comes after the plan

Planning is the whole tutorial: it needs nothing from AWS. When you are ready to deploy, the same
flow continues:

```bash
hero-cloud deploy examples/api-only     # shows the plan again; creates nothing until you approve it
hero-cloud health <deployment>          # what was checked, and what that check does not cover
hero-cloud outputs <deployment>         # where it is: links, addresses, and cost
hero-cloud destroy <deployment>         # a plan to remove it; your data stays until you delete it
```

Deploying needs credentials for your own AWS account (a profile, SSO, or environment variables) and
refuses to run as the account owner. Exit code `4` means the deployment finished but the health
checks did not show it working — the checks say what they observed instead of claiming success.

## Where to go next

- `examples/static-site` and `examples/spa` are planned as `static`; `examples/scheduled-job` and
  `examples/api-dynamodb` stay `serverless` and add a schedule and a table; `examples/monorepo` asks
  which package to deploy and has `expected.api.json` for the analysis of `apps/api`.
- To add an example of your own stack, follow [`examples/README.md`](../examples/README.md) and
  [Contributing](../.github/CONTRIBUTING.md): a small app plus an `expected.spec.json` is enough.
