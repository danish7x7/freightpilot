# ADR-0008: PROPOSE-ONLY create_booking — the confirmation-gate seam as inert data + a type-level ToolExecution union

- **Status:** accepted
- **Date:** 2026-07-21
- **Phase/Layer:** Phase 2 / agent-phase L2 (global L5) — tool loop + extraction/validation (§6.2 / §6.3.1)
- **Deviates from master plan:** no (it IMPLEMENTS §6.3's confirmation-gating invariant; it REFINES the create_booking description in §6.2 / ADR-0005 — the tool now PROPOSES, the L3 gate EXECUTES)

> Numbering note: the merged commit `acfca7d` references "(ADR-0007)" for the L1 provider-availability change (drop paywalled Cerebras / live-verify the chain), but no `0007-*.md` file was ever committed. To avoid reusing a number a merged commit already bound to a different topic, this ADR takes **0008** and leaves 0007 as a documented gap (see the journal). Backfilling 0007 needs that session's details, which this session did not have.

## Context
L2 builds the tool loop on L1's `buildLlmRouter`. Tools map 1:1 to the PUBLIC rates/booking REST endpoints — no privileged path (§2.2). The load-bearing invariant is §6.3: **no booking executes without an explicit human click** — restated for the tool loop as "there is NO code path from LLM output to booking execution." But ADR-0005 described the agent's `create_booking` as literally "`POST /bookings` then `POST /bookings/{id}/confirm`," which — taken at face value inside the L2 loop — would let an LLM tool call reach booking execution directly. Something has to make execution structurally unreachable from LLM output while still leaving a clean seam for L3's confirmation gate to execute. Architecture-guardian returned PASS WITH CONDITIONS and required this seam pinned before L2. Trigger: `docs/journal/2026-07-21.md` Session 2.

## Options considered
1. **create_booking executes both calls (literal ADR-0005 prose)** — pro: fewest moving parts, matches §6.2 wording; con: the LLM tool loop can reach `POST /bookings` directly, so §6.3 is enforced only by a runtime check a loop bug can bypass. Rejected.
2. **create_booking is PROPOSE-ONLY: `execute()` omits the HTTP clients param and returns inert, JSON-serializable proposal data; L3's gate executes (chosen)** — pro: execution is unreachable from the loop by construction (you cannot call an HTTP client you were never handed); the proposal is a TYPE-LEVEL seam; con: the two real POSTs move to L3, so L2 alone can't be E2E-verified to book (acceptable — booking is L3's job).
3. **A runtime flag / boolean the gate flips on create_booking** — pro: single tool; con: safety by discipline — a flag can be flipped by a bug and there is no structural or compile-time guarantee. Rejected.

## Decision
`create_booking` is **PROPOSE-ONLY**. Its `execute()` **omits the `clients` param entirely** and returns `buildCreateBookingProposal(...)` — inert, fully JSON-serializable data that **structurally cannot reach** `POST /bookings` or `/confirm`. `confirmBooking` is **NOT a tool**; confirm is folded in as the inert second step of the proposal. `cancelBooking` is **EXCLUDED** from the toolset. `hold_quote` remains a LIVE quote-tool (it acts on the quote, not the booking); the proposal only REFERENCES an already-HELD quote.

The proposal models ADR-0005's **two calls** as the seam L3 fills: a create step with a **null Idempotency-Key slot** and a confirm step with a **null bookingId**. L3 mints the confirmation token, reuses it as BOTH the create `Idempotency-Key` AND the gate credential, and fills `bookingId` from the create result. The `ToolExecution` **discriminated union** (`service_result` | `proposal`) makes this a **type-level seam**: the compiler distinguishes a live tool result from a proposal, so a proposal can never be silently mistaken for an executed action. `AGENT_ACTOR` is a fixed const, never sourced from LLM output.

Deciding rationale: §6.3's invariant should be TRUE BY CONSTRUCTION, not a runtime check a reviewer must keep re-verifying — withholding the HTTP client from the propose path makes "no code path from LLM output to booking execution" a fact of the call graph and the type system.

## Consequences
- **Easier:** the confirmation gate is structural — L3 builds token/gate/execution on a seam that already exists in the types; the "no auto-book" claim is *provable*. A structural test asserts proposing issues ZERO HTTP calls to booking-service (pendingInterceptors stay unconsumed under `disableNetConnect` + JSON round-trip purity), plus a loop-level proposal test.
- **Harder / ruled out:** `create_booking` can no longer be the thing that books — L3 MUST implement execution, and L2 alone cannot be E2E-verified to produce a booking. Cancel is unavailable to the agent until deliberately re-added.
- **Relationship to ADR-0005 (refinement, not supersession):** the two POSTs still happen, but at the L3 GATE, not inside the tool. ADR-0005's hold-model / first-write-wins idempotency / actor-agnostic-confirm decisions are untouched.
- **Revisit when:** L3 wires the gate (fill the null token + bookingId slots; token→Idempotency-Key); if an agent cancel flow is ever needed; and per a code-review carry — consider carrying the `calculate_quote` result SERVER-SIDE in L3 rather than routing `breakdown`/`total_cents`/`currency` back through the LLM's tool call (today the model re-emits computed money).
