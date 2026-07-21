// Runtime client for booking-service — mirrors the client's src/api/booking.ts wiring so the
// agent hits the SAME public booking API the UI does (§2.2 rule 1). createClient<paths> builds
// every URL from the generated contract (booking.gen.ts); baseUrl is the service origin ONLY.
// Transport wiring only: this wrapper NEVER enforces the booking state machine — a 409
// ILLEGAL_TRANSITION / STATE_CONFLICT is booking-service's authoritative veto (§2.4), which
// the tool layer forwards verbatim. The wrapper re-implements no booking logic (courier).
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./booking.gen.js";

// Same X-Request-Id middleware as rates.ts — mirrored, not shared, so each per-service client
// stays self-contained (no premature client factory).
const requestId: Middleware = {
  onRequest({ request }) {
    if (!request.headers.get("X-Request-Id")) {
      request.headers.set("X-Request-Id", crypto.randomUUID());
    }
    return request;
  },
};

export type BookingClient = ReturnType<typeof createClient<paths>>;

/** Build a booking-service client bound to `baseUrl` (BOOKING_SERVICE_URL from config). */
export function createBookingClient(baseUrl: string): BookingClient {
  const client = createClient<paths>({ baseUrl });
  client.use(requestId);
  return client;
}
