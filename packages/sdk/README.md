# SDK

**Status:** Implemented (contracts only; `createHero` is next).

The API of Hero's **headless engine** and the **single door into Hero**. The CLI, Studio, the local server, the MCP server, IDE extensions, and any product built on Hero use it. It exposes analyze, plan, deploy (with a person's approval), outputs, health, and destroy, and takes its dependencies as ports (AI, state, logger, source, cloud). It has no dependency on presentation, prompts, or any interface.

It must work without a Hero account, without the official website, and without any Cloud Republic service. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#core-contracts).
