import type { BookingClient, RatesClient, ToolClients } from "./agent.js";

/**
 * Stub `ToolClients` (guardian condition C2 + C5). We stub ONLY the network edge — the
 * `rates`/`booking` clients (tools/types.ts:15-18). We NEVER stub the loop, the Zod `validate`
 * path, or the proposal seam; those are the things under test and run for real.
 *
 * Each client method echoes the args the (already Zod-validated) tool passed into `ToolResult.data`
 * (C5), so score.ts can subset-match expected KEY args against what the loop actually extracted and
 * forwarded. It also records every call so the C4 through-turn assertion can prove ZERO booking
 * side-effects. create_booking calls NOTHING here (it returns an inert proposal) — that is exactly
 * the invariant, so a booking call appearing in this log would itself be a failure.
 */
export interface StubCall {
  service: "rates" | "booking";
  method: string;
  path: string;
  /** Flattened echo of query + path + body args the tool forwarded. */
  args: Record<string, unknown>;
}

export interface StubClients {
  clients: ToolClients;
  calls: StubCall[];
}

/** openapi-fetch's per-call options we care about: `{ params: { query, path }, body }`. */
interface FetchOptions {
  params?: { query?: Record<string, unknown>; path?: Record<string, unknown> };
  body?: unknown;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"] as const;

function flattenArgs(options: unknown): Record<string, unknown> {
  const o = (options ?? {}) as FetchOptions;
  const body = o.body && typeof o.body === "object" ? (o.body as Record<string, unknown>) : {};
  return { ...(o.params?.query ?? {}), ...(o.params?.path ?? {}), ...body };
}

function makeClient(service: "rates" | "booking", calls: StubCall[]): Record<string, unknown> {
  const client: Record<string, unknown> = {};
  for (const method of HTTP_METHODS) {
    client[method] = async (path: string, options?: unknown) => {
      const args = flattenArgs(options);
      calls.push({ service, method, path, args });
      // Echo the forwarded args as the service "data" (C5). A real `Response` so the tool's
      // `toToolResult(response, data, error)` sees response.ok === true (courier forwards a 200).
      return { data: args, error: undefined, response: new Response(null, { status: 200 }) };
    };
  }
  // openapi-fetch clients expose `.use`/`.eject` for middleware; the tools never call them, but
  // keep no-op shims so the shape can never surprise a future tool that does.
  client.use = () => {};
  client.eject = () => {};
  return client;
}

export function makeStubClients(): StubClients {
  const calls: StubCall[] = [];
  const clients: ToolClients = {
    rates: makeClient("rates", calls) as unknown as RatesClient,
    booking: makeClient("booking", calls) as unknown as BookingClient,
  };
  return { clients, calls };
}
