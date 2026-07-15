# ADR-0003: Surcharge composition is percent-of-base, per-line rounded, summing exactly to the total

- **Status:** accepted
- **Date:** 2026-07-14
- **Phase/Layer:** Phase 0 / L2 Domain/Service (rates-service)
- **Deviates from master plan:** no (§4.4 asks for a quote breakdown; the composition semantics are unspecified there — this ADR fixes them, consistent with domain-notes.md line 26 "percent of base")

## Context
L2 computes a quote as a base freight charge (from the mode's RateStrategy) plus a set of surcharges, and returns a `breakdown[]` whose lines are shown to the user and re-derived by booking-service at hold time. Surcharges are either FLAT (a fixed amount) or PERCENT. The ambiguity flagged by architecture-guardian: a PERCENT surcharge could mean "percent of the base freight" or "percent of the running total so far" (base + already-applied surcharges) — the two give different totals and make the result order-dependent. All money is integer cents, so rounding also has to be pinned. This shape is load-bearing: booking-service must reproduce it byte-for-byte across the service boundary.

## Options considered
1. **Percent-of-running-total** — pro: mirrors how some tariffs stack (tax-on-tax); con: order-dependent, needs a defined surcharge sequence, and a re-order in the DB silently changes the price — fragile across services.
2. **Percent-of-base, per-line HALF_UP, lines sum to total** — pro: order-immaterial by construction, each line independently auditable, breakdown lines add up to `total_cents` exactly; con: cannot express a tax-on-tax surcharge if the domain ever needs one.

## Decision
PERCENT surcharges are computed as a percentage of the **base freight only** (never base+flats or a running total); each line is rounded HALF_UP to integer cents independently; and the emitted `breakdown[]` lines sum exactly to `total_cents`. All arithmetic is BigDecimal/integer — no `double`. Order is immaterial by construction, so `findSurcharges` still applies a stable `ORDER BY calc,type,id` purely for deterministic breakdown presentation, not for correctness. This matches domain-notes.md line 26 and keeps the single composition point in `QuoteCalculator`.

## Consequences
- Easier: quotes are order-independent and reproducible; the breakdown is self-auditing (lines add to the total); booking-service can re-derive the same number from the same inputs without knowing surcharge order.
- Harder / ruled out: tax-on-tax (compounding) surcharges are not expressible — a genuine compounding requirement would need a new SurchargeCalc and a revisit of this ADR.
- Revisit if: the domain introduces a surcharge that must apply to an already-surcharged amount, or if a future mode needs a rounding mode other than HALF_UP.
