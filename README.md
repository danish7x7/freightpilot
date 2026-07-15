# FreightPilot

Agentic freight quoting and booking platform — a self-serve product where an AI agent can quote and book shipments end to end through the **same public APIs a human uses**. Microservices, provider-agnostic LLM layer, CI-gated evals, confirmation-gated actions, $0 inference cost.

Full plan: [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md). Conventions: [`CLAUDE.md`](CLAUDE.md).

## Two load-bearing architectural rules

1. **The agent consumes the same public APIs as the UI.** No privileged agent path — agent-service reaches rates/booking over REST only, never their databases. This keeps the audit trail (`actor=agent`) honest.
2. **Each service owns its database.** Cross-service data flows through REST contracts only; no shared tables, no cross-service hard FKs.

## Architecture

| Service | Stack | Owns |
|---|---|---|
| `services/rates` | Java 21 / Spring Boot 3 / Postgres | Lanes, rate cards, surcharges, quote calculation |
| `services/booking` | TS / Fastify / Postgres | Quote holds, booking state machine, event log, idempotency |
| `services/agent` | TS / Fastify / Postgres | NL intake, tool loop, provider adapter, confirmation gating, telemetry |
| `client` | React 18 / Vite | Manual flow, agent chat, confirmation cards, telemetry dashboard |

Each service owns its own Postgres instance on a dedicated DB-only network.

## Quickstart

```bash
cp .env.example .env      # optional — dev defaults work out of the box
make up                   # build + start all services; blocks until healthchecks are green
make ps                   # show health status
make down                 # tear down
```

Health endpoints once up: `http://localhost:8080/health` (rates), `:8081` (booking), `:8082` (agent).

## Make targets

| Target | Does |
|---|---|
| `make up` | Build + start the stack, wait for all healthchecks green |
| `make down` | Stop and remove containers + volumes |
| `make test` | Run each service's test suite |
| `make seed` | Seed data — no-op until L1 |
| `make evals` | Eval suite — no-op until L6 |

## Status

**L0 (Foundation) — in progress.** Monorepo skeleton, Compose with per-service Postgres + healthchecks, Makefile, CI (lint + hello-world test per service). See the layered plan in `docs/MASTER_PLAN.md` §3.
