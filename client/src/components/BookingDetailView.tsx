import { useQueryClient } from "@tanstack/react-query";
import {
  useBooking,
  useConfirmBooking,
  useCancelBooking,
  type BookingStatus,
} from "../api/bookingHooks";
import { EventTimeline } from "./EventTimeline";

// A booking + its event timeline, read from GET /api/v1/bookings/{id}. The Confirm/Cancel
// buttons are rendered as UX affordances derived from the SERVER's current status, but the
// client never enforces the §2.4 state machine: a raced 409 (ILLEGAL_TRANSITION / STATE_CONFLICT)
// is surfaced verbatim as the authority. booking-service is the only place transitions are legal.
const CANCELLABLE: BookingStatus[] = ["QUOTED", "HELD", "CONFIRMED"];

export function BookingDetailView({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const detail = useBooking(bookingId);
  const confirm = useConfirmBooking(queryClient);
  const cancel = useCancelBooking(queryClient);

  if (detail.isLoading) return <p>Loading booking…</p>;
  if (detail.isError) return <p role="alert">Could not load booking: {detail.error.message}</p>;
  if (!detail.data) return null;

  const { booking, events } = detail.data;
  const busy = confirm.isPending || cancel.isPending;

  return (
    <section aria-label="Booking detail">
      <h2>
        Booking {booking.shipper_ref} — <span data-testid="booking-status">{booking.status}</span>
      </h2>
      <dl>
        <dt>Reference</dt>
        <dd>{booking.shipper_ref}</dd>
        <dt>Booking id</dt>
        <dd>{booking.id}</dd>
      </dl>

      <div>
        {/* Confirm is offered ONLY for a HELD booking and only on a real click (§2.4). */}
        {booking.status === "HELD" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => confirm.mutate(bookingId)}
          >
            Confirm booking
          </button>
        )}
        {CANCELLABLE.includes(booking.status) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => cancel.mutate(bookingId)}
          >
            Cancel booking
          </button>
        )}
      </div>

      {/* The server's veto, surfaced verbatim — the client made no transition decision. */}
      {confirm.isError && <p role="alert">Confirm failed: {confirm.error.message}</p>}
      {cancel.isError && <p role="alert">Cancel failed: {cancel.error.message}</p>}

      <EventTimeline events={events} />
    </section>
  );
}
