// Runtime client for booking-service — mirrors the rates.ts wiring (§2.2 rule 1: the UI
// hits the SAME public booking API the agent will later use). createClient<paths> builds
// every URL from the generated contract (src/api/booking.gen.ts); baseUrl is the gateway
// origin ONLY, paths come from the contract — never hand-concatenated.
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./booking.gen";

const baseUrl = import.meta.env.VITE_BOOKING_URL ?? "http://localhost:8081";

// Mint an X-Request-Id per request so the UI's correlation story matches booking-service's
// onRequest hook (§5: X-Request-Id in, echoed out; validated against /^[A-Za-z0-9._-]{1,64}$/,
// which a UUID satisfies). Same shape as rates.ts — deliberately mirrored, not shared, so each
// per-service client stays self-contained (guardian: no premature client factory).
const requestId: Middleware = {
  onRequest({ request }) {
    if (!request.headers.get("X-Request-Id")) {
      request.headers.set("X-Request-Id", crypto.randomUUID());
    }
    return request;
  },
};

export const bookingClient = createClient<paths>({ baseUrl });
bookingClient.use(requestId);

/**
 * Error carrying the uniform ErrorEnvelope (§5) so the UI can show code + message. A 409 with
 * code ILLEGAL_TRANSITION / STATE_CONFLICT is the booking state machine's authoritative veto
 * (§2.4) — the client never enforces transitions itself, it surfaces whatever booking-service
 * returns. Tolerates a missing/partial envelope (e.g. a 5xx with an empty body) so a transport
 * failure still becomes a clean typed error, not a raw TypeError.
 */
export class BookingApiError extends Error {
  readonly code: string;
  readonly details: string[];
  constructor(envelope?: Partial<components_ErrorEnvelope>) {
    super(envelope?.message ?? "Unexpected error from booking-service");
    this.name = "BookingApiError";
    this.code = envelope?.code ?? "UNKNOWN";
    this.details = envelope?.details ?? [];
  }
}

// Pulled from the generated contract types — no forked/duplicated shapes (§5 "do not fork").
type components_ErrorEnvelope =
  import("./booking.gen").components["schemas"]["ErrorEnvelope"];
