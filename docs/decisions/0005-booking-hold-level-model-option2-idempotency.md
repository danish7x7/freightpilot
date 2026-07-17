# ADR-0005: Booking hold-level model — born QUOTED, held on create (Option 2); actor-agnostic confirm; first-write-wins idempotency

- **Status:** accepted
- **Date:** 2026-07-16
- **Phase/Layer:** Phase 1 / L6 Booking Domain (booking-service)
- **Deviates from master plan:** no (this RESOLVES an underspecification in §2.4 / §5 and reconciles an internal plan discrepancy between §2.3 and §6.2 — it does not depart from any stated rule)

## Context
§5's hold endpoint acts on the **quote** (`quote_status` ACTIVE→HELD), but §2.4's booking machine needs a **booking** in `HELD` before `CONFIRMED` — and the plan defines no booking-hold endpoint, so nothing puts a booking into HELD. The two enums even share the token `HELD` (`quote_status.HELD` vs `booking_status.HELD`), which invites conflation. There is also an internal plan discrepancy: §2.3's sequence draws a single `POST /bookings` → `CONFIRMED`, while §6.2 and §5 define **two** distinct calls, `POST /bookings` (create) and `POST /bookings/{id}/confirm`. Architecture-guardian flagged all of this at the booking-L2 gate and required this ADR to pin the resolution before the machine could be trusted as the single enforcement point.

## Options considered
1. **Option 1 — `POST /bookings` creates the booking directly in HELD, QUOTED vestigial** — pro: one fewer transition; con: contradicts §2.4's `[*]→QUOTED` initial state and the schema's `booking_status` default, leaving QUOTED as dead state the machine never emits. Rejected.
2. **Option 2 — born QUOTED, held-on-create in one transaction (chosen)** — pro: honours §2.4's INITIAL state and default; every booking passes through the machine's real entry; con: two `booking_events` rows per create and a transient QUOTED that no route rests on today.
3. **Option 3 — relax confirm to accept QUOTED→CONFIRMED** — pro: skips the intermediate HELD; con: violates §2.4's explicit `HELD→CONFIRMED` edge and removes the hold as a real lifecycle stage. Rejected.

## Decision
`POST /bookings` requires a **HELD quote**; the booking is **born at QUOTED** (the machine's INITIAL, created via the state machine with a `null→QUOTED` birth event) and transitioned **QUOTED→HELD in the SAME transaction** (two `booking_events` rows), and the quote is **CONSUMED** — all atomic. Then `POST /bookings/{id}/confirm` is `HELD→CONFIRMED`, and `POST /bookings/{id}/cancel` is `{QUOTED,HELD,CONFIRMED}→CANCELLED`. On the §2.3-vs-§6.2 discrepancy, **§6.2/§5 are authoritative**: there are two calls (create then confirm); §2.3's single arrow is diagram compression. The agent's `create_booking` tool = `POST /bookings` then `POST /bookings/{id}/confirm` (§6.2).

**actor-agnostic confirm.** booking-service stamps whatever `actor ∈ {user, agent, system}` the caller sends into `booking_events`; the "user click only" gate (§2.4 annotation) is enforced **upstream** in agent-service's confirmation token (§6.3.2), not in the booking API — because the booking API is the *same public API* for UI and agent (§2.2 rule 1). booking-service validates that `actor` is a legal enum but otherwise trusts it (acceptable: real auth is a Non-Goal for this build).

**Idempotency = first-write-wins.** Replaying an `Idempotency-Key` returns the **original** booking (200 vs 201 on first create); a divergent payload on the same key is **ignored** (no request-fingerprint, no 409-on-mismatch). Race-safety comes from three layers: a fast replay **pre-SELECT**, the `UNIQUE(idempotency_key)` constraint (catch Postgres `23505`), **and** a `StateConflict` re-check — because under `FOR UPDATE` serialization the concurrent *loser* reaches the "quote must be HELD" precondition after the winner has already CONSUMED the quote, so it must re-check the key and replay the original rather than 409.

**quote_status** uses centralized guarded transitions (`assertQuoteTransition`), **not** the full State pattern and **no** `quote_events` table — §4.4 scopes the State pattern to bookings only.

## Consequences
- Easier: every booking enters through the machine's real INITIAL state, so the "single enforcement point" claim holds with no back-door construction; the create path is atomic (birth + hold + quote-consume) so a partial hold can't exist; idempotent create is race-safe under genuine concurrency.
- QUOTED is **transient-by-construction today** but a real resting state reserved for a future direct-booking flow (create without a prior hold) — kept in the machine deliberately, not vestigial.
- Modeled-but-inert: `DOCUMENTS_ISSUED` and the `EXPIRED` transitions are in the machine and unit-tested (`actor=system`) but have **no route and no scheduler**; the quote's `expires_at` is set (+24h) but **not enforced** (no sweeper). All deferred.
- Follow-ups (from security-reviewer, tracked here): bump `drizzle-orm >= 0.45.2` (GHSA-gpj5-g38j-94v9 — not exploitable today, identifiers are static); when auth lands, **scope the Idempotency-Key lookup to the caller/tenant** and **bind `actor` to the authenticated principal** (both are caller-trusted today).
- Revisit when: a direct-booking flow needs QUOTED as a resting state; a documents/expiry driver is built; or auth lands (then tenant-scope idempotency + bind actor).
