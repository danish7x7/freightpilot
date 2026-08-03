# FreightPilot

An agentic freight quoting and booking platform where an AI agent quotes and books shipments through the same public REST APIs a human uses. No privileged agent path, no back door, and no booking that executes without an explicit human click.

> **Demo:** _(coming soon: a GIF walkthrough and a live URL will land here)_

## What makes this interesting

### "LLM proposes, never executes": the confirmation gate

The agent produces an INERT proposal. It literally cannot call the booking endpoints, because the `create_booking` tool's execute function is not even handed an HTTP client (ADR-0008, the propose-only seam). The only thing that triggers real execution is a crypto-random 256-bit single-use token, bound to a server-authoritative proposal stored in agent-service's own database, and it is redeemed by an explicit user click on `POST /api/v1/confirmations/:token` (ADR-0009, the gate). This is enforced STRUCTURALLY, not by discipline: the executor (the only code that issues the two real booking calls) is unreachable from the LLM tool loop, and a static import-graph test asserts that unreachability so a future loop bug cannot open a path to execution.

### The eval gate, with a floor fixed before the number existed

44 cases authored, 42 driven, across three tiers that all gate merges: extraction (floor 0.79), tool choice (0.8), and safety (1.0). `make evals` replays committed provider recordings, so CI makes zero API calls and needs no secrets.

The part worth checking the commit log for: the extraction floor was pre-registered in writing at `367ea06`, a day before the capture it judges existed (`f03aaa1`). It is argued from an independent standard, not fitted to an observed rate. All 13 literal-extraction cases must pass, plus a bare majority (6 of 11) of the cases that require applying a documented rule. The bound a prompt would score handling no hard class at all is computed against the shipped counts (13/24 = 0.5417), so the floor is not clearable by the easy cases alone. The v1 run scored **0.8333** and the floor was never adjusted (ADR-0012).

Prompts and eval cases are versioned source: changing either takes a PR, an eval run, and a committed scorecard. The recording key hashes the prompt text, the tool contract, and `prompt_version` together, so an edited prompt cannot quietly replay fixtures captured under a different one, and a test asserts that a degraded prompt produces a different key.

### Process discipline

Contracts come first. The OpenAPI specs in `contracts/*.openapi.yaml` generate the typed clients, and CI regenerates them and runs `git diff --exit-code` so a committed client can never silently drift from its contract. Every real decision gets an ADR in `docs/decisions/`. Each service owns its own Postgres, enforced at the Docker network layer (each database sits on a per-service `internal: true` network the other services cannot route to). CI also runs a Spectral contract lint (with a ruleset self-test) and an oasdiff breaking-change check on every pull request.

### Provider-agnostic LLM layer at $0

The LLM layer is hand-rolled `fetch` with no vendor SDKs (ADR-0006), which keeps one normalizer and one error classifier over the raw HTTP bytes and shrinks the dependency and attack surface. An ordered fallback chain fails over ONLY on an allowlist (429, 5xx, timeout, network), so a genuine bug is never masked as a provider outage. Record/replay fixture tests exercise the whole adapter with ZERO live provider calls in CI. The live-verified chain is primary `gemini:gemini-3.1-flash-lite`, fallback `groq:llama-3.3-70b-versatile`; Cerebras was dropped when its free tier turned paywalled (ADR-0007). The primary is an explicit model id rather than an alias, because `gemini-flash-latest` silently rotated into a lower-quota tier mid-capture and the requested-model field recorded no trace of it (ADR-0007 Amendment A). Target LLM spend is $0 via free tiers.

## Architecture

Four services, each with its own stack and its own Postgres.

| Service | Stack | Port | Owns |
|---|---|---|---|
| `services/rates` | Java 21, Spring Boot 3, Maven, Flyway | 8080 | Lanes, rate cards, surcharges, quote calculation (strategy per mode) |
| `services/booking` | TypeScript, Fastify, Drizzle | 8081 | Quote holds, the booking lifecycle state machine (single enforcement point, illegal transition is a typed 409), append-only event log, idempotency |
| `services/agent` | TypeScript, Fastify, Drizzle | 8082 | NL intake, the tool loop, the provider adapter, the confirmation gate (its DB currently holds the `confirmations` table; conversation history and telemetry are planned, not built) |
| `client` | React 18, Vite, TanStack Query | | Manual flow, quote breakdown, booking detail, event timeline |

Money is integer cents end to end. Cross-service data flows through REST contracts only; there are no shared tables and no cross-service hard foreign keys.

The Compose topology enforces database ownership by routing. There is a shared `backend` REST plane (no database is on it), plus `rates_db_net`, `booking_db_net`, and `agent_db_net`, each `internal: true` and attached ONLY to its owning service. agent-service is on `[backend, agent_db_net]`, so it reaches rates and booking over public REST on `backend` and can route to ONLY its own database, never theirs.

```mermaid
graph TB
    C[React Client]

    subgraph backend["backend (shared REST plane, no DB)"]
      R[rates-service<br/>Java 21 / Spring Boot 3<br/>:8080]
      B[booking-service<br/>TS / Fastify / Drizzle<br/>:8081]
      A[agent-service<br/>TS / Fastify / Drizzle<br/>:8082]
    end

    L[Provider-agnostic LLM adapter]

    C -->|REST| R
    C -->|REST| B
    C -->|chat| A
    A -->|public REST only| R
    A -->|public REST only| B
    A --> L
    L -->|primary| P1[gemini-3.1-flash-lite]
    L -->|allowlist fallback| P2[groq llama-3.3-70b]

    R -->|rates_db_net internal| DR[(Postgres: rates)]
    B -->|booking_db_net internal| DB[(Postgres: booking)]
    A -->|agent_db_net internal| DA[(Postgres: agent / confirmations)]
```

## The booking flow (where the gate is visible)

1. **Calculate quote.** Pure calculation in rates-service (no side effects).
2. **Persist the quote**, then **hold** it (quote goes ACTIVE to HELD).
3. **The agent PROPOSES `create_booking`.** This is an inert proposal; the gate mints a token and returns a confirmation card. Nothing has executed.
4. **The user clicks confirm**, which redeems the token.
5. **The gate executes TWO real calls** (ADR-0005): `POST /bookings` (the booking is born QUOTED then moves to HELD, idempotent on `token = Idempotency-Key`), then `POST /bookings/{id}/confirm` (HELD to CONFIRMED).

The user click is the only thing between a proposal and execution.

## Quickstart

Prerequisites: Docker (with Compose), Node 22 and pnpm 9, and JDK 21 with Maven for the rates service.

```bash
make up               # build + start, wait for healthchecks, print rates:8080 booking:8081 agent:8082
make seed             # load rates demo data (idempotent, safe to re-run)
make migrate-booking  # apply booking-service Drizzle migrations
make migrate-agent    # apply agent-service Drizzle migrations (the confirmations table)
make test             # run each service's test suite
make evals            # replay the committed recordings and apply the tier gates (no API calls)
make down             # stop and remove containers + volumes
```

The databases publish no host ports (ADR-0001): they sit on internal-only networks, so `make seed` and the migrations run inside the Compose network. Environment templates live at `./.env.example` (root) and `./services/agent/.env.example`.

## Project status

Honest and current. There is no live instance and no public URL yet.

- **Phase 1 is complete and CI-green:** rates-service, booking-service, and the client manual flow (search, quote, hold, book, confirm or cancel, with booking detail and an event timeline).
- **Phase 2 is complete:** L1 (the provider-agnostic LLM adapter), L2 (the tool loop with extraction and validation), L3 (the confirmation gate and booking execution), L5 (the v1 system prompt), L6 (the eval harness), plus the chat UI and confirmation cards in the client.
- **Outstanding:** the telemetry dashboard (D15) and the AWS deploy (Phase 3, not yet built).

### CI

Every push runs: `node-services` (lint, typecheck, test, build for booking and agent, plus an agent-scoped generated-client drift gate), `client` (plus its own drift gate), `client-e2e` (Playwright, hermetic against a mocked rates API; the live-stack booking E2E is deferred per ADR-0004), `rates-service` (`mvn verify` with Testcontainers), `booking-it` and `agent-it` (Testcontainers integration against real Postgres), `contracts` (Spectral lint, a ruleset self-test, and an oasdiff breaking-change check), and `evals` (`make evals` replays the committed recordings and exits non-zero if any gating tier drops below its floor, plus the eval runner's own test suite). The evals job is hermetic: no network, no secrets.

## Open items

Carried deliberately and in the open, rather than closed by weakening what they measure.

- **The degraded-prompt measurement (L5-C19) has not been run.** The 7-case subset and the exact degradation are pre-registered in ADR-0012, so running it later cannot be fitted to a result. Deferred on time, not quota.
- **The eval suite cannot observe a tool-mediated booking side-effect.** The through-turn scorer watches the confirmation gate's HTTP client, not the tool loop's, so a `create_booking` that really posted while still returning a well-formed proposal would score green. Four agent-service tests do catch it and run in CI, so the gap is in what the evals can see, not in the propose-only seam itself.
- **The validation-retry path is exercised and asserted, but not gated.** Deleting the retry turns four tests red and still clears the extraction floor by one case. Closing it needs a new case pre-registered before its recording exists.
- **One safety failure mode named in the plan lost its only case.** Nothing currently pressures the agent to book an unheld quote; the precondition is taught by the prompt and is not enforced by the tool's schema.
- **Two eval stimuli reuse phrasings the prompt enumerates**, one of them in the safety tier. No pass rate depends on it, but those two cases cannot distinguish rule-following from phrase-matching. The fix is held-out cases, never editing the prompt after the fact.
- **The Groq `tool_use_failed` 400 (ADR-0011 finding b) is still open.** Groq validates tool arguments server-side and rejects before the loop's retry engages, so that path is unverified on the fallback provider.

## Decision log

Decisions are recorded as ADRs under [`docs/decisions/`](docs/decisions/). The load-bearing ones:

- **[ADR-0005](docs/decisions/0005-booking-hold-level-model-option2-idempotency.md)**: booking hold-level model, born QUOTED and held on create, actor-agnostic confirm, first-write-wins idempotency.
- **[ADR-0006](docs/decisions/0006-llm-adapter-hand-rolled-fetch-no-sdk.md)**: hand-rolled LLM adapter, no SDKs, record/replay at the HTTP boundary.
- **[ADR-0007](docs/decisions/0007-live-verified-llm-provider-availability.md)**: live-verified LLM chain, Cerebras dropped; Amendment A replaces the Gemini alias with an explicit model id after it rotated tiers mid-capture.
- **[ADR-0008](docs/decisions/0008-propose-only-create-booking-seam.md)**: the propose-only `create_booking` seam.
- **[ADR-0009](docs/decisions/0009-agent-l3-confirmation-gate.md)**: the L3 confirmation gate.
- **[ADR-0012](docs/decisions/0012-l5-system-prompt-extraction-gating-methodology.md)**: the extraction gating methodology, the pre-registered floor, the prompt composition seam, and prompt-version ownership.
- **[ADR-0013](docs/decisions/0013-provider-dialect-opaque-token-round-trip.md)**: round-tripping a thinking model's opaque token through the adapter, which is part of the request contract rather than a provider detail.

The full plan lives in [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md).
