import type { z } from "zod";
import type { LlmToolSchema } from "../llm/index.js";
import type { RatesClient } from "../api/rates.js";
import type { BookingClient } from "../api/booking.js";
import type { CreateBookingProposal } from "./proposal.js";

/**
 * The agent's own identity for every mutating call it makes. FIXED here, never
 * taken from LLM output — the model cannot make the agent impersonate `user` or
 * `system`. booking-service stamps this into booking_events (§2.4, ADR-0005).
 */
export const AGENT_ACTOR = "agent" as const;

/** The per-service clients a tool needs, injected so tests can point them at mocked origins. */
export interface ToolClients {
  rates: RatesClient;
  booking: BookingClient;
}

/**
 * A service response forwarded VERBATIM (courier principle §2.2). A non-2xx — including a
 * 409 the booking state machine returns — is authoritative data to relay to the caller, NOT
 * a thrown error: the agent never re-decides what the service already decided.
 */
export type ToolResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: unknown };

/**
 * The outcome of running a tool. Live tools return `service_result` (they called their ONE
 * endpoint). create_booking returns `proposal` — inert data, having called NOTHING. This
 * discriminated shape is the seam that makes "LLM proposes, never executes" checkable: a
 * `proposal` outcome provably issued zero HTTP calls (see the create_booking guard test).
 */
export type ToolExecution =
  | { kind: "service_result"; result: ToolResult }
  | { kind: "proposal"; proposal: CreateBookingProposal };

/**
 * One tool = one public rates/booking endpoint (courier wrapper over the generated client).
 * `validate` is the Zod gate on LLM-extracted arguments — the seam the extract→retry loop
 * drives. `execute` receives arguments the loop has ALREADY validated with `validate`.
 */
export interface Tool {
  readonly name: string;
  /** JSON-Schema tool definition handed to the LLM. */
  readonly schema: LlmToolSchema;
  /** Zod validator for the LLM-extracted arguments. */
  readonly validate: z.ZodTypeAny;
  /** Courier execution. Args are pre-validated by the loop against `validate`. */
  execute(args: unknown, clients: ToolClients): Promise<ToolExecution>;
}

/**
 * Shape an openapi-fetch result `{ data, error, response }` into a ToolResult, forwarding the
 * service's response verbatim. Tolerates a bodiless failure (e.g. a 5xx with an empty body,
 * where openapi-fetch leaves `error` undefined) by synthesizing a minimal envelope — same
 * tolerance the client's ApiError wrappers apply, so a transport failure is still a clean
 * typed result, not a raw undefined.
 */
export function toToolResult(response: Response, data: unknown, error: unknown): ToolResult {
  if (response.ok) {
    return { ok: true, status: response.status, data };
  }
  return {
    ok: false,
    status: response.status,
    error: error ?? { code: "UNKNOWN", message: `HTTP ${response.status} from service`, details: [] },
  };
}
