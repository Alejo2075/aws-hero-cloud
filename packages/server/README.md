# @hero-cloud/server

The local server behind Studio. A door like the CLI: it contains no planning or AWS logic, only the SDK and `presentation`.

- Listens on `127.0.0.1` only, on a random port; any other `Host` is refused (DNS rebinding).
- The printed address carries a one-time code. Exchanging it sets an `HttpOnly`, `SameSite=Strict` cookie; the code works once and expires.
- Every write needs the cookie, a matching anti-forgery header, and an `Origin` equal to the server's own. No CORS headers are ever sent. A strict Content-Security-Policy applies.
- The browser sends plan ids and digests. The approval is created here, only when the page reports an explicit confirmation of the exact digest; plans the engine did not produce are refused.
- Folders must be inside the allowed roots (symbolic links resolved); uploads must be ZIP files under a size limit and are stored privately.
- Secret values go straight to `hero.deploy` and are never stored, logged, or returned.
- Progress is streamed as server-sent events.

See `tests/studio-server.test.ts`.
