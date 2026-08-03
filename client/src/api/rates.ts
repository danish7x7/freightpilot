// Runtime client for rates-service — the openapi-fetch wiring L3 deferred to L4.
// createClient<paths> builds every URL from the generated contract (src/api/rates.gen.ts),
// so the UI hits the SAME documented public paths the agent will later use (§2.2 rule 1).
// baseUrl is the gateway origin ONLY; paths come from the contract — never hand-concatenated.
// It defaults to "" (SAME-ORIGIN), matching agent.ts: requests go out as relative paths and the
// Vite dev proxy forwards them to rates-service:8080 — see ../../proxy.config.ts. There is NO prod
// gateway in this repo yet: nginx is L7/§9 work, so a built bundle served by anything other than
// `vite preview` currently has nothing forwarding these paths.
// This is what keeps X-Request-Id off a preflight: an absolute origin here makes the GET non-simple
// and cross-origin, which is exactly the OPTIONS 403 this default exists to avoid.
// VITE_RATES_URL overrides it for a deployment that fronts the services at a DIFFERENT origin than
// the client; setting it re-introduces the cross-origin request and its CORS requirements.
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./rates.gen";

const baseUrl = import.meta.env.VITE_RATES_URL ?? "";

// Mint an X-Request-Id per request so the UI's correlation story matches the agent's
// and rates-service's RequestIdFilter (§5: X-Request-Id in, echoed out, logged).
const requestId: Middleware = {
  onRequest({ request }) {
    if (!request.headers.get("X-Request-Id")) {
      request.headers.set("X-Request-Id", crypto.randomUUID());
    }
    return request;
  },
};

export const ratesClient = createClient<paths>({ baseUrl });
ratesClient.use(requestId);

/**
 * Error carrying the uniform ErrorEnvelope (§5) so the UI can show code + message.
 * Tolerates a missing/partial envelope — a 5xx with an empty or non-JSON body leaves
 * openapi-fetch's `error` undefined, and we still want a clean typed failure, not a
 * raw TypeError.
 */
export class RatesApiError extends Error {
  readonly code: string;
  readonly details: string[];
  constructor(envelope?: Partial<components_ErrorEnvelope>) {
    super(envelope?.message ?? "Unexpected error from rates-service");
    this.name = "RatesApiError";
    this.code = envelope?.code ?? "UNKNOWN";
    this.details = envelope?.details ?? [];
  }
}

// Pulled from the generated contract types — no forked/duplicated shapes (§5 "do not fork").
type components_ErrorEnvelope =
  import("./rates.gen").components["schemas"]["ErrorEnvelope"];
