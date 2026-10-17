# @hero-cloud/provider-ai

Bring-your-own AI for the one job it is allowed to do: help describe a project that deterministic
analysis cannot fully read. Adapters for Anthropic, OpenAI, any OpenAI-compatible server, Ollama (on
your computer), and Amazon Bedrock all implement the same small `AIProvider` interface.

What keeps it safe (see [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md#ai-providers)):

- **Consent first.** The engine never contacts a model without a granted scope.
- **Minimum context, redacted.** `buildContext` sends names and, if allowed, short pieces of manifests
  and entry files; secret-looking files are never included and `redact` strips keys, tokens, private
  keys, and credentials in addresses before anything leaves.
- **Limits.** `withLimits` caps calls, context size, output size, and estimated cost per run.
- **Fill gaps only.** `applyRefinement` accepts a small fixed set of plain facts, checks each against
  a pattern, never changes what analysis found, never takes commands, addresses, secrets, permissions, or
  cloud resources, and discards the whole answer if the result is not a valid Hero Spec.

Tests in `tests/ai.test.ts` run recorded model answers, including the worst a fully obedient model
could say after reading a hostile project.
