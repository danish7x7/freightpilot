// Runtime client for rates-service — mirrors the client's src/api/rates.ts wiring so the
// agent hits the SAME public rates API the UI does (§2.2 rule 1). createClient<paths> builds
// every URL from the generated contract (rates.gen.ts); baseUrl is the service origin ONLY,
// paths come from the contract — never hand-concatenated. This wrapper is transport wiring
// only: it re-implements NO rates logic and enforces no business rules (courier principle).
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./rates.gen.js";

// Mint an X-Request-Id per request so the agent's correlation story matches rates-service's
// RequestIdFilter (§5: X-Request-Id in, echoed out, logged) — keeps the actor=agent audit
// trail traceable end-to-end. Same shape as the client's middleware, deliberately mirrored.
const requestId: Middleware = {
  onRequest({ request }) {
    if (!request.headers.get("X-Request-Id")) {
      request.headers.set("X-Request-Id", crypto.randomUUID());
    }
    return request;
  },
};

export type RatesClient = ReturnType<typeof createClient<paths>>;

/** Build a rates-service client bound to `baseUrl` (RATES_SERVICE_URL from config). */
export function createRatesClient(baseUrl: string): RatesClient {
  const client = createClient<paths>({ baseUrl });
  client.use(requestId);
  return client;
}
