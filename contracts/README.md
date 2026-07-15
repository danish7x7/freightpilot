# contracts/

OpenAPI 3 specs, written **before** implementation (L3 gate — see `docs/MASTER_PLAN.md` §3, §5). The spec in this directory is the cross-service source of truth: services implement it, consumers generate typed clients from it, and CI gates every change against it.

Specs:

- `rates.openapi.yaml` — rates-service (landed at L2, ADR-0003; contract-first).
- `booking.openapi.yaml` — _booking-service (arrives at L3/D7)._
- `agent.openapi.yaml` — _agent-service (Phase 2)._

## Conventions (§5), enforced by the ruleset

- Uniform error envelope everywhere: `{ code, message, details[] }` via the shared `ErrorResponse` component.
- `X-Request-Id` declared on **every** response (in, echoed out, logged).

`.spectral.yaml` extends `spectral:oas` and adds these two conventions as custom `error`-level rules, so every spec — present and future — is held to the same contract.

## Tooling (L3 gate)

This is a dev-tooling package (`private`, devDeps only — no runtime code, no generated code lives here).

```bash
pnpm install          # once
pnpm lint             # spectral lint of *.openapi.yaml (fails on any warning)
```

CI (`.github/workflows/ci.yml`, `contracts` job) additionally runs an **oasdiff** breaking-change check on PRs (each spec vs its version on the base branch; a brand-new spec with no base version is skipped).

The generated TypeScript client lives with its consumer, not here: `client/src/api/rates.gen.ts`, produced by `pnpm --dir client gen:api` and drift-checked in CI.
