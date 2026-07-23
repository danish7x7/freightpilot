// Runtime client for agent-service — the L5 chat turn endpoint + the confirmation gate.
// Mirrors the rates/booking wiring (createClient<paths> from the generated contract; paths come
// from agent.gen.ts, never hand-concatenated) with ONE deliberate difference: the baseUrl defaults
// to "" (SAME-ORIGIN). The confirmation token is a secret credential (ADR-0009 Cond. F); a relative
// base means it rides a same-origin fetch — the Vite dev proxy (or the prod gateway) forwards
// /api/v1/turns and /api/v1/confirmations to agent-service:8082, and the token never crosses an
// origin boundary. This is the ONLY client that can reach the gate; the agent flow never imports
// bookingClient (guardian Condition 8 — the only booking-causing call it makes is redeeming here).
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./agent.gen";

const baseUrl = import.meta.env.VITE_AGENT_URL ?? "";

// Mint an X-Request-Id per request so the UI's correlation story matches agent-service's onRequest
// hook (§5). Same middleware shape as rates/booking — mirrored, not shared (no premature factory).
const requestId: Middleware = {
  onRequest({ request }) {
    if (!request.headers.get("X-Request-Id")) {
      request.headers.set("X-Request-Id", crypto.randomUUID());
    }
    return request;
  },
};

export const agentClient = createClient<paths>({ baseUrl });
agentClient.use(requestId);

/**
 * Error carrying the uniform ErrorEnvelope (§5) so the UI can key on the WIRE code — the two-channel
 * redeem model (D14 Condition 4): 200/202 return a RedeemResult body; 4xx/5xx return this envelope.
 * The codes the card branches on: CONFIRMATION_EXPIRED (410), CONFIRMATION_NOT_FOUND (404),
 * QUOTE_UNAVAILABLE (409), BOOKING_EXECUTION_FAILED (502). Tolerates a missing/partial envelope so a
 * bodiless 5xx still becomes a clean typed error, not a raw TypeError.
 */
export class AgentApiError extends Error {
  readonly code: string;
  readonly details: string[];
  constructor(envelope?: Partial<components_ErrorEnvelope>) {
    super(envelope?.message ?? "Unexpected error from agent-service");
    this.name = "AgentApiError";
    this.code = envelope?.code ?? "UNKNOWN";
    this.details = envelope?.details ?? [];
  }
}

// Pulled from the generated contract types — no forked/duplicated shapes (§5 "do not fork").
type components_ErrorEnvelope = import("./agent.gen").components["schemas"]["ErrorEnvelope"];
