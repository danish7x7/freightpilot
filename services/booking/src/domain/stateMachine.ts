// The booking lifecycle state machine (§2.4) — the SINGLE point that decides whether a
// booking_status transition is legal. Every status write in the service (including the
// null → QUOTED birth) goes through assertTransition, so an out-of-order transition is
// impossible to apply by construction, not by discipline. It is PURE (no DB) so every
// legal/illegal transition is unit-testable without a container.
//
// State-pattern in its transition-table form (a class holding the allowed-target map),
// which reads cleaner in TS than one class per state for a lifecycle this size.
import { bookingStatus } from "../db/schema.js";
import { IllegalTransitionError } from "./errors.js";

export type BookingStatus = (typeof bookingStatus.enumValues)[number];

export class BookingStateMachine {
  /** allowed target statuses for each status. Terminal states map to []. */
  private static readonly TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
    QUOTED: ["HELD", "CANCELLED", "EXPIRED"],
    HELD: ["CONFIRMED", "CANCELLED", "EXPIRED"],
    CONFIRMED: ["DOCUMENTS_ISSUED", "CANCELLED"],
    DOCUMENTS_ISSUED: [],
    EXPIRED: [],
    CANCELLED: [],
  };

  /** The only legal birth state (§2.4 [*] → QUOTED). */
  static readonly INITIAL: BookingStatus = "QUOTED";

  /** `from === null` models the booking's birth: only null → INITIAL is legal. */
  canTransition(from: BookingStatus | null, to: BookingStatus): boolean {
    if (from === null) return to === BookingStateMachine.INITIAL;
    return BookingStateMachine.TRANSITIONS[from].includes(to);
  }

  /** Throws {@link IllegalTransitionError} (HTTP 409) if the transition is not allowed. */
  assertTransition(from: BookingStatus | null, to: BookingStatus): void {
    if (!this.canTransition(from, to)) {
      throw new IllegalTransitionError(from, to);
    }
  }

  isTerminal(status: BookingStatus): boolean {
    return BookingStateMachine.TRANSITIONS[status].length === 0;
  }
}

/** Shared singleton — the one enforcement point every mutation must route through. */
export const bookingStateMachine = new BookingStateMachine();
