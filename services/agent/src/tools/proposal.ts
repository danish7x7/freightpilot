import type { components } from "../api/booking.gen.js";
import { AGENT_ACTOR } from "./types.js";

type CreateBookingRequest = components["schemas"]["CreateBookingRequest"];
type ActorRequest = components["schemas"]["ActorRequest"];

/**
 * PROPOSE-ONLY output of the create_booking tool (L2 — the load-bearing invariant).
 *
 * Per ADR-0005 a real booking is TWO calls: POST /bookings (create, born QUOTED→HELD,
 * requires a HELD quote, Idempotency-Key required) then POST /bookings/{id}/confirm
 * (HELD→CONFIRMED). This object MODELS both and EXECUTES NEITHER.
 *
 * It is INERT DATA by construction: a plain, fully JSON-serializable object with no method,
 * closure, or client reference — it cannot reach POST /bookings or /confirm. That is the seam
 * L3's confirmation gate fills: L3 mints the confirmation token, drops it into
 * `create.idempotencyKey`, executes step 1, resolves `confirm.bookingId` from the response,
 * then executes step 2. L2 mints no token and runs no step. The zero-HTTP-call guarantee is
 * regression-guarded by test/tools/booking.test.ts.
 */
export interface CreateBookingProposal {
  readonly kind: "create_booking_proposal";
  /** Step 1 — POST /api/v1/bookings. Born QUOTED→HELD; consumes the referenced HELD quote. */
  readonly create: {
    readonly method: "POST";
    readonly path: "/api/v1/bookings";
    /**
     * Idempotency-Key slot. NULL in L2. L3 reuses the confirmation token as this key
     * (§6.3, ADR-0005: create is first-write-wins idempotent on it) — one token becomes
     * both the create idempotency key AND the gate credential.
     */
    readonly idempotencyKey: null;
    readonly body: CreateBookingRequest;
  };
  /** Step 2 — POST /api/v1/bookings/{id}/confirm. HELD→CONFIRMED. */
  readonly confirm: {
    readonly method: "POST";
    readonly pathTemplate: "/api/v1/bookings/{id}/confirm";
    /** Resolved from step-1's response at L3 execution time; unknowable while proposing. */
    readonly bookingId: null;
    readonly body: ActorRequest;
  };
}

/**
 * Build the inert proposal from validated args. `quote_id` references an ALREADY-HELD quote
 * (the agent holds a quote via the separate hold_quote tool — the proposal does NOT perform
 * the hold, Flag 1). Returns pure data; touches no network.
 */
export function buildCreateBookingProposal(args: {
  quote_id: string;
  shipper_ref: string;
}): CreateBookingProposal {
  return {
    kind: "create_booking_proposal",
    create: {
      method: "POST",
      path: "/api/v1/bookings",
      idempotencyKey: null,
      body: { quote_id: args.quote_id, shipper_ref: args.shipper_ref, actor: AGENT_ACTOR },
    },
    confirm: {
      method: "POST",
      pathTemplate: "/api/v1/bookings/{id}/confirm",
      bookingId: null,
      body: { actor: AGENT_ACTOR },
    },
  };
}
