// Quote lifecycle (quote_status). Near-linear, so it's a centralized guard function
// rather than the full State-pattern machine the booking lifecycle gets (§4.4 scopes the
// State pattern to bookings). This is the ONE place quote transitions are validated.
import { quoteStatus } from "../db/schema.js";
import { StateConflictError } from "./errors.js";

export type QuoteStatus = (typeof quoteStatus.enumValues)[number];

const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  ACTIVE: ["HELD", "EXPIRED"],
  HELD: ["CONSUMED", "EXPIRED"],
  CONSUMED: [],
  EXPIRED: [],
};

export function assertQuoteTransition(from: QuoteStatus, to: QuoteStatus): void {
  if (!QUOTE_TRANSITIONS[from].includes(to)) {
    throw new StateConflictError(`Quote cannot move ${from} → ${to}`);
  }
}
