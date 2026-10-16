# Local runtime

**Status:** Implemented (types only).

What makes Hero run on one person's machine with their own AWS account and their own AI: configuration, credential resolution through the standard AWS chain, the keychain-backed secret store, local deployment state, and AI consent records.

Nothing here contacts a Hero or Cloud Republic service. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#local-runtime).
