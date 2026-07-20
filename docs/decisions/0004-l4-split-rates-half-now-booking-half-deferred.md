# ADR-0004: L4 split — ship the rates-facing manual flow now, defer the booking half until booking-service exists

- **Status:** accepted
- **Date:** 2026-07-15
- **Phase/Layer:** Phase 1 / L4 Presentation (client)
- **Deviates from master plan:** yes (§3 L4 and §11 D8 define L4 as search → quotes → **book** → detail w/ event timeline plus a full Playwright happy path; the Phase-1 exit §11 is "a human quotes **and books** on the public URL"). This slice delivers only the quote half, so L4's DoD and the Phase-1 exit are NOT met by it.

## Context
L4 as planned is search → quotes → **book** → booking detail w/ event timeline, with a Playwright happy path against the live compose stack (§3 L4, §9, §11 D8). The rates-facing half can be built now against the merged `contracts/rates.openapi.yaml`, but the booking half depends on booking-service (D6–D7), which does not exist and has no `booking.openapi.yaml`. Architecture-guardian confirmed a narrowed scope and required this ADR to record the deviation. Building a booking UI now would have to invent an API to call — violating §5 (contract-first: no contract to build against) and §2.2 (client owns no business logic; booking state is booking-service's).

## Options considered
1. **Defer the booking half; ship the rates half; keep L4's gate open (chosen)** — pro: every part built is contract-correct against a real spec, no wasted work on the ready rates half; con: L4 stays open and Phase-1 exit is not reached until booking-service lands.
2. **Stub a fake booking path in the client** — pro: L4 "looks" complete end to end; con: violates §5 (a hand-invented booking API with no contract) and §2.2 (business logic / booking state leaking into the client) — a fake path we'd have to unbuild. Rejected.
3. **Block all of L4 until booking-service exists** — pro: L4 ships in one atomic, fully-planned slice; con: wastes the rates half that is ready now and serializes work that has no dependency on booking-service. Rejected.

## Decision
Split L4 into a **rates half** (search form → quote list → quote breakdown, wired to rates-service via the L3-generated client) shipped now, and a **booking half** (the "book" action, booking detail view, event timeline, and the full live-stack Playwright happy path) deferred until booking-service and `booking.openapi.yaml` exist. **L4's review gate stays OPEN** and the Phase-1 exit ("a human quotes and books") is explicitly NOT met by this slice. Deferring is the contract-correct choice; stubbing a fake booking path was rejected because there is no contract to build against (§5) and the client owns no booking state (§2.2).

## Consequences
- Easier: the ready rates half ships and is E2E-verified now (narrowed DoD: "manual search→quote E2E passes"); the runtime `openapi-fetch` wiring L3 deferred is now done on the generated `rates.gen.ts` with no forked types and an X-Request-Id middleware matching rates-service's RequestIdFilter (§5).
- Interim exception: the shipped E2E is a **hermetic mocked-network Playwright** test, a documented, time-boxed exception to §9's live-compose-stack E2E. Its fixtures are TYPED against the generated contract (drift breaks the build), and it is to be replaced by the live-stack happy path at the deploy step (D9).
- Harder / ruled out: L4 cannot be closed and Phase-1 cannot exit until the booking half lands; a fake/stubbed booking path is ruled out.
- Deferred obligation (tracked here): the "book" action, booking detail view, event timeline, and the FULL live-compose-stack Playwright happy-path E2E — all blocked on booking-service (D6–D7) and its missing `booking.openapi.yaml`. When those exist, build the booking half, replace the hermetic E2E with the live-stack happy path, THEN close the L4 gate and reach the Phase-1 exit.
- Revisit when: `booking.openapi.yaml` is authored and booking-service endpoints are up (D6–D7). Also run security-reviewer on the new client deps (@tanstack/react-query, openapi-fetch, @playwright/test) at the Phase-1 exit gate.

## Resolution / addendum — 2026-07-20 (booking half built by PR-B)

The original decision above is unchanged; this addendum records how its deferred obligation was discharged.

- **DISCHARGED by PR-B** (client-only, stacked on PR-A; see `docs/journal/2026-07-20.md`): the "book" action, the booking detail view, the event timeline, and a hermetic mocked-network Playwright happy path with fixtures TYPED against `booking.gen.ts` (drift breaks the build). Also done: the security-reviewer pass on the new client deps this ADR asked for — `pnpm audit --prod` = 0 vulns across client deps, no Critical/High/Medium, confirmation-gate honesty verified (**PASS**). The client acts as an orchestrator/courier (§6.2): it forwards rates-owned data verbatim, does no rate math (§2.2), hardcodes `actor='user'` so privilege can't be forged, and never enforces booking transitions (§2.4 — the server's 409 is authoritative).
- **STILL DEFERRED, by this ADR's own terms:** the FULL live-compose-stack Playwright happy path, which moves to the deploy step (D9). The hermetic mocked-network E2E remains the stand-in until then.
- **Gate status:** the L4 review gate is now **READY FOR external review but remains OPEN**. Closing L4 and declaring the Phase-1 exit ("a human quotes and books") is the external claude.ai reviewer's call — not reached by PR-B.
