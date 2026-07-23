# ADR-0010: Publish the agent-service OpenAPI contract — supersedes ADR-0009 Flag 7

- **Status:** accepted
- **Date:** 2026-07-22
- **Phase/Layer:** Phase 2 / D14 (client chat UI + confirmation-gate wiring, §L5)
- **Deviates from master plan:** no — it RETURNS to the plan. `contracts/agent.openapi.yaml` is listed in the §5 source tree (`MASTER_PLAN.md`) and named in `contracts/README.md` as a coming Phase-2 spec. ADR-0009 Flag 7 was the deviation; this ADR ends it.

## Context
ADR-0009 Flag 7 ruled the confirmation-gate endpoints "UI-internal" and published **no** OpenAPI/spectral contract for agent-service, unlike rates/booking. The stated reasoning: the endpoints are "consumed by the same-origin L5 chat UI, not external clients." That consumer did not exist yet. D14 is that consumer arriving — a chat panel in the separately-built, separately-deployed `@freightpilot/client` package that reaches agent-service over HTTP. Both halves of Flag 7's premise now fail inspection: the client is **not same-origin** (it calls services cross-origin via absolute `VITE_*_URL`; the nginx gateway that would make it same-origin is deferred, `docker-compose.yml`), and it is **not internal** (a different package/deploy unit consuming the API over the wire). Triggered by the D14 design review (architecture-guardian PASS WITH CONDITIONS, Condition 1) and the §5 contracts-first rule.

## Options considered
1. **Uphold Flag 7 — hand-roll `CardState`/`RedeemResult`/error-code types in the client.** Pro: no new spec. Con: the client would **fork** the server's shapes with nothing to catch drift — the exact failure §5's "generated client, do not fork" + spectral/oasdiff gate exists to prevent. Every existing client api file already pulls its types from generated contracts for this reason. Rejected.
2. **Publish `contracts/agent.openapi.yaml`, generate the client, join the §5 gate (chosen).** Pro: one source of truth; CI catches drift; completes a spec the plan tree and `contracts/README.md` already advertised. Con: a new spec to maintain — accepted; it is the same discipline the other two services already carry.

## Decision
Publish `contracts/agent.openapi.yaml` covering the **full public surface the client consumes** — `POST /api/v1/turns` (the four-arm turn response) plus the two confirmation-gate endpoints (`GET`/`POST /api/v1/confirmations/{token}`) — and wire it into the same tooling as rates/booking: spectral lint (`pnpm lint` globs `*.openapi.yaml`), the oasdiff breaking-change gate (CI loops `contracts/*.openapi.yaml`; a brand-new spec with no base version is skipped), and client generation (`client gen:api` → `client/src/api/agent.gen.ts`, drift-checked by `git diff --exit-code src/api`). This **supersedes ADR-0009 Flag 7**; ADR-0009 remains the historical record of why Flag 7 was reasonable while agent-service had no consumer.

Deciding rationale: a contract's job is to stop a consumer's types drifting from the server's. The moment a separately-built client consumes the gate over HTTP, that job exists — regardless of runtime origin — so §5 binds agent-service exactly as it binds rates/booking. Documenting the token-bearing `proposal` arm leaks nothing: a spec describes shape, not secret values, and the token is still returned only in the response body and never re-emitted by `GET` (ADR-0009 Cond. F preserved).

## Consequences
- **Easier:** the client generates its agent types (`agent.gen.ts`) and cannot fork gate/turn shapes; any server/spec drift fails CI like rates/booking. The spec is executable documentation of the four-arm turn contract and the two-channel redeem result (200/202 body vs 4xx/5xx envelope).
- **Harder / ruled out:** agent-service now owns a third spec to keep in sync with its hand-written response shapes (it is the server, so it does not generate a client from its own spec — the shapes in `gate/gateService.ts` and the turn handler must match `agent.openapi.yaml` by review + the route integration tests, not by codegen).
- **Revisit when:** the L5 prompt PR lands `POST /api/v1/turns`' live-LLM behaviour (D14 wired the seam with no system prompt — see the D14 journal); if the turn contract grows (streaming, richer tool arms) the spec and its oasdiff gate move with it. When the nginx gateway lands and the client becomes genuinely same-origin, the contract stays — the "external consumer" argument was never the only reason; drift-prevention is.
