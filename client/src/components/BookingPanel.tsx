import { useRef, useState } from "react";
import type { QuoteResponse, ShipmentSpec } from "../api/hooks";
import {
  useCreateQuote,
  useHoldQuote,
  useCreateBooking,
  type CreateQuoteRequest,
} from "../api/bookingHooks";
import { BookingDetailView } from "./BookingDetailView";

// Bridges a rates quote into a booking. The client is the ORCHESTRATOR (§6.2 — the same role
// the agent plays later): it forwards the (lane_id, rate_card_id) pair PLUS the priced breakdown
// verbatim from the rates QuoteResponse into booking's POST /quotes, then holds and books. It
// asserts none of that data itself and does no rate math (§2.2) — every value comes from rates.
export function BookingPanel({
  quote,
  shipment,
}: {
  quote: QuoteResponse;
  shipment: ShipmentSpec;
}) {
  const [shipperRef, setShipperRef] = useState("");
  const [bookingId, setBookingId] = useState<string | null>(null);

  // ONE idempotency key for this panel instance (i.e. this quote). Reused across retries and
  // double-clicks so booking-service's first-write-wins (ADR-0005) returns the original booking
  // instead of creating a duplicate. RatesPage remounts the panel per selected card (keyed on
  // rate_card_id), so a genuinely new booking attempt gets a fresh key.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const createQuote = useCreateQuote();
  const holdQuote = useHoldQuote();
  const createBooking = useCreateBooking();

  // Synchronous re-entry guard: `isPending` only flips after a re-render, so two clicks in the
  // same tick would both pass a state-based check. A ref blocks the second one immediately.
  const inFlight = useRef(false);

  const pending = createQuote.isPending || holdQuote.isPending || createBooking.isPending;
  const stepError = createQuote.error ?? holdQuote.error ?? createBooking.error ?? null;

  async function reserve() {
    if (inFlight.current) return;
    inFlight.current = true;
    // Clear any prior step error so a retry starts clean (react-query keeps the last error until
    // its mutation is re-invoked, which for createBooking is last in the chain).
    createQuote.reset();
    holdQuote.reset();
    createBooking.reset();

    // Courier the priced quote into booking-service, unchanged. lane_id + rate_card_id come as a
    // pair from rates; breakdown/total_cents/currency are the server's computed values (never
    // re-summed here). shipment is the spec the user searched with.
    const request: CreateQuoteRequest = {
      lane_id: quote.lane_id,
      rate_card_id: quote.rate_card_id,
      shipment,
      breakdown: quote.breakdown,
      total_cents: quote.total_cents,
      currency: quote.currency,
    };
    try {
      const persisted = await createQuote.mutateAsync(request); // ACTIVE
      const held = await holdQuote.mutateAsync(persisted.id); // HELD
      const booking = await createBooking.mutateAsync({
        quoteId: held.id,
        shipperRef,
        idempotencyKey,
      }); // booking HELD
      setBookingId(booking.id);
    } catch {
      // Each step's typed error is surfaced below via stepError; swallow the rejection so the
      // click handler doesn't produce an unhandled promise. The server remains the authority.
      // A retry re-runs the whole chain: createQuote/holdQuote are not idempotency-keyed, so a
      // partial failure can leave an orphan ACTIVE quote that booking-service's expiry reaps —
      // but the reused idempotencyKey means POST /bookings can never double-BOOK.
    } finally {
      inFlight.current = false;
    }
  }

  if (bookingId) {
    return <BookingDetailView bookingId={bookingId} />;
  }

  return (
    <section aria-label="Book this quote">
      <h3>Book this quote</h3>
      <p>
        Reserve the {quote.mode} quote {quote.origin_code} → {quote.dest_code} as a HELD booking,
        then confirm it.
      </p>
      <label>
        Your reference
        <input
          name="shipper_ref"
          value={shipperRef}
          onChange={(e) => setShipperRef(e.target.value)}
          placeholder="e.g. PO-4471"
          required
        />
      </label>
      <button type="button" onClick={reserve} disabled={pending || shipperRef.trim() === ""}>
        {pending ? "Reserving…" : "Reserve booking"}
      </button>
      {stepError && <p role="alert">Could not reserve: {stepError.message}</p>}
    </section>
  );
}
