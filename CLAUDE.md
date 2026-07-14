# CLAUDE.md — FreightPilot Conventions

## Project summary

FreightPilot is an agentic freight quoting and booking platform: a self-serve product where an AI agent can quote and book shipments end to end through the same public APIs a human uses. It is a microservices system — `rates-service` (Java 21 / Spring Boot 3), `booking-service` and `agent-service` (TypeScript / Fastify), and a React client — each service owning its own Postgres database. The agent runs on a provider-agnostic LLM layer (primary Gemini 2.5 Flash, automatic fallback to Groq/Cerebras) with confirmation-gated actions, so no booking executes without an explicit human click. Quality is CI-gated: unit tests plus a 40-case eval suite run on every push, and eval pass rate below threshold blocks merge. Total LLM spend target: $0 via free tiers and synthetic data. See `docs/MASTER_PLAN.md` for the full plan.

## Hard architecture rules

These are load-bearing. State them in the README; defend them in interviews; never violate them without an ADR in `docs/decisions/`.

**From §2.2 — Service responsibility matrix:**
- **The agent consumes the SAME public APIs as the UI.** No privileged agent path. agent-service reaches rates/booking through their public REST endpoints only — never direct DB access to rates or bookings. This keeps the audit trail (`actor=agent`) honest.
- **Each service owns its database.** Cross-service data flows through REST contracts only. No shared tables, no cross-service hard FKs (cross-service references are FK-by-convention only).
- Service ownership boundaries (owns / does NOT own):
  - `rates-service` owns lanes, rate cards, surcharges, quote calculation (strategy per mode). Does NOT own booking state or anything agent.
  - `booking-service` owns quote holds, booking lifecycle state machine, event log, idempotency. Does NOT own rate math.
  - `agent-service` owns NL intake, tool loop, provider adapter, validation/retry, confirmation gating, telemetry, conversation state. Does NOT own direct DB access to rates/bookings.
  - `client` owns the manual flow, agent chat panel, confirmation cards, telemetry dashboard. Does NOT own business logic.
- **Never bypass the booking state machine.** State transitions are enforced in exactly one class per service; an invalid transition is a typed 409. Every transition appends to `booking_events` with `actor ∈ {user, agent, system}`. Mutating booking state outside the machine must be impossible by construction.

**From §3.7 — CLAUDE.md conventions:**
- agent-service NEVER touches the rates or booking databases.
- Never bypass the state machine.
- Commit style: conventional, scoped commits; PR-per-change with CI green required.
- Test commands live per service (see below).
- **Prompt files are code** — changing a prompt requires a PR *and* an eval run.
- Decisions live in `docs/decisions/` (ADR-style, numbered); the session journal lives in `docs/journal/`.
- **Layer gates require external review before proceeding** — each layer DoD and every phase exit is gated by an external claude.ai reviewer session before the next layer starts.

## Subagent protocol
- Before implementing any new layer, endpoint, or refactor: consult architecture-guardian.
- After completing any feature and before committing: run code-reviewer; fix Blocking items before commit.
- After changes touching agent layer, confirmation gate, APIs, env/config, or deps: run security-reviewer. FAIL blocks merge.
- On any failing test/error/odd agent behavior: hand to debugger; implement its MINIMAL FIX and REGRESSION GUARD.
- On prompt or eval changes: run eval-auditor before merging.
- At the end of EVERY session: run scribe (journal + LEARNING.md + ADRs). Sessions without a scribe pass are incomplete.
- Phase exits require: architecture-guardian PASS, security-reviewer PASS, eval-auditor SOUND (Phase 2+), then external review.
- Subagents report findings; the main session implements fixes. Only scribe writes docs.

## Test & build commands per service

Placeholders — fill in as each service materializes. Prefer the top-level `make` targets once L0 lands (`make up`, `make seed`, `make test`, `make evals`).

| Service | Build | Test | Lint/Typecheck |
|---|---|---|---|
| rates-service (Java 21 / Spring Boot 3 / Maven) | _TODO: `mvn -q package`_ | _TODO: `mvn -q test`_ | _TODO_ |
| booking-service (TS / Fastify / Drizzle) | _TODO: `pnpm build`_ | _TODO: `pnpm test`_ | _TODO: `pnpm lint && pnpm typecheck`_ |
| agent-service (TS / Fastify) | _TODO: `pnpm build`_ | _TODO: `pnpm test`_ | _TODO: `pnpm lint && pnpm typecheck`_ |
| client (React 18 / Vite / TanStack Query) | _TODO: `pnpm build`_ | _TODO: `pnpm test` + Playwright E2E_ | _TODO: `pnpm lint && pnpm typecheck`_ |
| evals | — | _TODO: `make evals`_ | — |

## Prompts and eval cases are code

Prompt files (`prompts/*.md`) and eval cases (`evals/cases/**`) are versioned source, not config. Any change to them:
- must go through a **PR** — never edited directly on `main`;
- must **run the eval suite** (`make evals`) and attach/commit the resulting scorecard to `evals/results/` (e.g. `evals/results/2026-07-24_v3.json`);
- is gated by **eval-auditor** before merge;
- carries its `prompt_version`, which is logged on every LLM request and stamped into every scorecard.

The rule, in one line: *prompt changes go through CI like any other change — prompts are regression-tested like code.*
