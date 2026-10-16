# Local server

**Status:** Planned: empty scaffold.

A JSON and server-sent-events API over the SDK, bound to `127.0.0.1` only. It lets [Studio](../../apps/studio), IDE extensions, and other local tools use the engine without embedding it.

It adds transport and nothing else: no planning, no AWS behavior, no accounts. Hardening requirements (loopback binding, per-session token, Host and Origin checks) are in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#doors).
