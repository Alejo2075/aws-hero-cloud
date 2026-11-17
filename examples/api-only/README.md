# api-only

A small Express API with two routes: `/healthz` for health checks, and `/hello` for a JSON reply.

Hero reads the folder as one **http service** — runtime `nodejs`, start command `npm start`, port
`3000`, health path `/healthz` — and plans it with the `serverless` strategy: a Lambda function
behind an HTTP API, with no cluster and no server to patch.

Walkthrough: [Tutorial: read your first plan with `examples/api-only`](../../docs/TUTORIAL-API-ONLY.md).

This folder is also a CI fixture: `tests/examples.test.ts` analyzes it and compares the result with
`expected.json`.
