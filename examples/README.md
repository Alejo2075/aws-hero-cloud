# Examples

Small applications that Hero should understand. Each one is a regression fixture: `tests/examples.test.ts` analyzes it and compares the result with `expected.spec.json`.

| Folder          | What it is                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `static-site`   | Plain HTML, no build tools                                                                                     |
| `spa`           | Vite and React single-page app (pnpm)                                                                          |
| `spa-api`       | Vite and React front end served by an Express API                                                              |
| `api-only`      | Express API (CommonJS) with a health route                                                                     |
| `api-dynamodb`  | Fastify API in TypeScript that reads DynamoDB                                                                  |
| `scheduled-job` | A cron job with no web server                                                                                  |
| `monorepo`      | Two packages in one repository; Hero asks which to deploy (`expected.api.json` analyzes `apps/api` on its own) |

To add one, create a folder with a small realistic app and an `expected.spec.json`, then run `pnpm test`. Examples are also the fastest way to contribute support for a stack Hero does not yet know: see [CONTRIBUTING.md](../.github/CONTRIBUTING.md).
