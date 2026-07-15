# contracts/

OpenAPI 3 specs, written **before** implementation (L3 gate — see `docs/MASTER_PLAN.md` §3, §5).

Nothing here yet at L0. These land at L3:

- `rates.openapi.yaml`
- `booking.openapi.yaml`
- `agent.openapi.yaml`

Uniform error envelope everywhere: `{ code, message, details[] }`. `X-Request-Id` in, echoed out, logged. Specs must lint clean (spectral) and pass a breaking-change check (oasdiff) on PRs.
