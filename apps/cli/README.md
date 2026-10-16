# Hero CLI

Put an application on your own AWS account, see exactly what will happen first, and get proof it
works. The binary is `hero-cloud`.

```bash
npx @hero-cloud/cli analyze ./my-app          # what does it need? (reads it, runs nothing)
npx @hero-cloud/cli plan ./my-app             # what would Hero create, and what would it cost?
npx @hero-cloud/cli deploy ./my-app           # shows the plan, deploys only after you approve
npx @hero-cloud/cli health hero-my-app        # is it working? (what was checked, and what was not)
npx @hero-cloud/cli outputs hero-my-app       # how to reach it, cost, where to look
npx @hero-cloud/cli secret hero-my-app NAME   # store a secret without echoing it
npx @hero-cloud/cli destroy hero-my-app       # a plan to remove it; keeps your data unless you delete it
```

`<source>` is a folder, a `.zip` file, or an `https://` Git repository. Hero reads it without
running anything.

Every command takes `--level simple|guided|expert` (how much detail), `--locale en|es`, and
`--json` for machine output. `deploy` and `destroy` ask a person to approve; a script passes the
exact plan digest with `--approve <digest>`. The CLI never approves for you.

Exit codes: `0` ok, `1` failed, `2` wrong command, `3` plan blocked (it needs something from you),
`4` deployed but the checks did not show it working.

Needs Node.js 22.12 or newer. Deploying needs AWS credentials for your own account (the usual
AWS profile, SSO, or environment variables) and never the account owner (root). The first deploy
asks you to approve a one-time preparation of the account with limited permissions. See the
[repository README](../../README.md) for troubleshooting.
