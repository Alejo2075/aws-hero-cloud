# Hero CLI

**Status:** Planned: empty scaffold.

The terminal interface. The binary is `hero-cloud`, installed by the npm package of the same name or run with `npx @hero-cloud/cli`. Commands map to SDK operations and must not contain planning or AWS business logic.

Initial commands: `hero-cloud init`, `hero-cloud analyze`, `hero-cloud plan`, `hero-cloud deploy`, `hero-cloud destroy`. Doors to the other interfaces: `hero-cloud studio` (local web UI) and `hero-cloud mcp` (agent server). Every command takes `--level simple|guided|expert` and `--locale`, and `--json` for machine output.

The CLI never approves on the user's behalf: non-interactive deploys require the exact plan digest (`--approve <digest>`).
