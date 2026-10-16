## What and why

<!-- What does this change, and why? Link the issue or RFC. -->

## Checklist

- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass
- [ ] Tests added or updated
- [ ] Docs updated (required for SDK, Hero Spec, plugin, analyzer, planner, or deployment changes)
- [ ] New rationale, warning, event, or check codes have `simple`, `guided`, and `expert` messages
- [ ] Interfaces call the SDK only; no AWS or planning logic outside its package
- [ ] No credentials, keys, secrets, or real account IDs in code, fixtures, or logs
- [ ] `rfc` issue linked if this is a major change
