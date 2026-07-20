// Data hooks over the booking contract. Types come straight from the generated client
// (§5 "do not fork") and every request goes through openapi-fetch (no hand-built URLs).
// The client is an ORCHESTRATOR, not a rule engine: it calls the public endpoints in order
// and renders whatever booking-service returns. It never enforces the §2.4 state machine —
// an illegal transition comes back as a 409 BookingApiError and is surfaced as-is.
import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { bookingClient, BookingApiError } from "./booking";
import type { components } from "./booking.gen";

export type Quote = components["schemas"]["Quote"];
export type Booking = components["schemas"]["Booking"];
export type BookingDetail = components["schemas"]["BookingDetail"];
export type BookingEvent = components["schemas"]["BookingEvent"];
export type BookingStatus = components["schemas"]["BookingStatus"];
export type Actor = components["schemas"]["Actor"];
export type CreateQuoteRequest = components["schemas"]["CreateQuoteRequest"];

// Phase 1 has exactly one actor: the human at the keyboard. The confirmation-token gate that
// lets the agent act as actor='agent' lives upstream in agent-service (§6.3) and arrives in
// Phase 2. Hardcoding 'user' here makes "the UI can only ever act as the user" true by
// construction — the client cannot forge an agent/system action (guardian conditions 4 & 7).
const USER: Actor = "user";

/** POST /api/v1/quotes — persist a calculated quote into booking-service (status ACTIVE). */
export function useCreateQuote() {
  return useMutation<Quote, BookingApiError, CreateQuoteRequest>({
    mutationFn: async (request) => {
      const { data, error } = await bookingClient.POST("/api/v1/quotes", { body: request });
      if (error || !data) throw new BookingApiError(error);
      return data;
    },
  });
}

/** POST /api/v1/quotes/{id}/hold — reserve the quote (ACTIVE → HELD). */
export function useHoldQuote() {
  return useMutation<Quote, BookingApiError, string>({
    mutationFn: async (quoteId) => {
      const { data, error } = await bookingClient.POST("/api/v1/quotes/{id}/hold", {
        params: { path: { id: quoteId } },
        body: { actor: USER },
      });
      if (error || !data) throw new BookingApiError(error);
      return data;
    },
  });
}

export interface CreateBookingInput {
  quoteId: string;
  shipperRef: string;
  // Owned by the CALLER, stable per logical attempt (guardian condition 5): reusing one key
  // across retries/double-clicks makes booking-service's first-write-wins idempotency (ADR-0005)
  // return the original booking instead of double-booking. A fresh key per click would defeat it.
  idempotencyKey: string;
}

/** POST /api/v1/bookings — create a booking from a HELD quote (idempotent). Lands in HELD. */
export function useCreateBooking() {
  return useMutation<Booking, BookingApiError, CreateBookingInput>({
    mutationFn: async ({ quoteId, shipperRef, idempotencyKey }) => {
      const { data, error } = await bookingClient.POST("/api/v1/bookings", {
        params: { header: { "Idempotency-Key": idempotencyKey } },
        body: { quote_id: quoteId, shipper_ref: shipperRef, actor: USER },
      });
      if (error || !data) throw new BookingApiError(error);
      return data;
    },
  });
}

/**
 * POST /api/v1/bookings/{id}/confirm — HELD → CONFIRMED. Invoked ONLY from a genuine user
 * click (§2.4 "confirm = user click only"); never auto-fired. actor='user' is honest here —
 * the agent's confirm goes through its own token gate in Phase 2, not this path.
 */
export function useConfirmBooking(queryClient: QueryClient) {
  return useMutation<Booking, BookingApiError, string>({
    mutationFn: async (bookingId) => {
      const { data, error } = await bookingClient.POST("/api/v1/bookings/{id}/confirm", {
        params: { path: { id: bookingId } },
        body: { actor: USER },
      });
      if (error || !data) throw new BookingApiError(error);
      return data;
    },
    // Refetch the detail so the timeline picks up the new CONFIRMED event from the server —
    // the authoritative record, not an optimistic client guess.
    onSuccess: (booking) => queryClient.invalidateQueries({ queryKey: ["booking", booking.id] }),
  });
}

/** POST /api/v1/bookings/{id}/cancel — QUOTED|HELD|CONFIRMED → CANCELLED. */
export function useCancelBooking(queryClient: QueryClient) {
  return useMutation<Booking, BookingApiError, string>({
    mutationFn: async (bookingId) => {
      const { data, error } = await bookingClient.POST("/api/v1/bookings/{id}/cancel", {
        params: { path: { id: bookingId } },
        body: { actor: USER },
      });
      if (error || !data) throw new BookingApiError(error);
      return data;
    },
    onSuccess: (booking) => queryClient.invalidateQueries({ queryKey: ["booking", booking.id] }),
  });
}

/** GET /api/v1/bookings/{id} — the booking plus its ordered booking_events timeline. */
export function useBooking(bookingId: string | null) {
  return useQuery<BookingDetail, BookingApiError>({
    queryKey: ["booking", bookingId],
    enabled: bookingId !== null,
    queryFn: async () => {
      const { data, error } = await bookingClient.GET("/api/v1/bookings/{id}", {
        params: { path: { id: bookingId! } },
      });
      if (error || !data) throw new BookingApiError(error);
      return data;
    },
  });
}
