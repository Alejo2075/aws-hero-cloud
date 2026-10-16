# @hero-cloud/mcp

The tools an AI assistant uses to work with Hero over the Model Context Protocol. Run it with
`hero-cloud mcp --allow <folder>` (repeat `--allow` for more folders; the default is the current one).

```bash
# Claude Code
claude mcp add hero-cloud -- npx @hero-cloud/cli mcp --allow ~/projects
```

```json
{
  "mcpServers": {
    "hero-cloud": {
      "command": "npx",
      "args": ["@hero-cloud/cli", "mcp", "--allow", "/Users/me/projects"]
    }
  }
}
```

## Tools

| Tool                  | What it does                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `hero_analyze`        | Reads a project inside an allowed folder, runs nothing, reports what it needs                  |
| `hero_plan`           | Makes a reviewable plan (resources, cost, risks) from an analysis the server made              |
| `hero_explain`        | Explains a plan or a deployment at a chosen level                                              |
| `hero_request_deploy` | Asks **a person** to approve a plan; returns the command they must run                         |
| `hero_request_status` | Says whether the person approved, declined, or has not answered, and what became of the deploy |
| `hero_outputs`        | How to reach a deployment, what it costs                                                       |
| `hero_health`         | Checks the deployment again; reports what was observed and what the checks cannot show         |
| `hero_plan_destroy`   | Plans the removal of a deployment (needs approval like any plan)                               |

**There is no tool that approves.** `hero_request_deploy` writes a request that only a person can answer,
by running `hero-cloud approve <request>` in their own terminal, where they see the plan and say yes or no.
The secret that makes an approval valid is in a private file on that machine and never passes through a
tool. Approvals work once, for that plan, account, and region, and expire.

## What protects the person

- **Allowed folders only.** Paths are resolved (symbolic links included) and must stay inside a folder
  given with `--allow`. Remote addresses are refused here.
- **Evidence, not contents.** Answers carry names, file paths, and what Hero found; file contents are never
  returned, and files that look like secrets are never read.
- **Untrusted data is labelled.** Anything derived from a project (names, paths, packages) can contain text
  meant to steer an assistant. Those results start with a notice and carry `untrusted: true`.
- **Progress** is reported with MCP progress notifications when the client asks for it.

## What it cannot protect against

An assistant that can run any command on your machine can run `hero-cloud` itself, read the files in
`.hero/`, or approve with `--approve <digest>`. Give assistants these tools, not a shell, if approval by a
person is what you rely on. Secrets are never accepted by these tools; use `hero-cloud secret`.
