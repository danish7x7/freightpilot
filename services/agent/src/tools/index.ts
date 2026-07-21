import { loadServiceConfig } from "../config.js";
import { createRatesClient } from "../api/rates.js";
import { createBookingClient } from "../api/booking.js";
import { calculateQuoteTool, searchRatesTool } from "./rates.js";
import { createBookingTool, createQuoteTool, getBookingTool, holdQuoteTool } from "./booking.js";
import type { Tool, ToolClients } from "./types.js";

export type { Tool, ToolClients, ToolExecution, ToolResult } from "./types.js";
export type { CreateBookingProposal } from "./proposal.js";

/**
 * The agent's tool set — each entry 1:1 with a PUBLIC rates/booking endpoint (guardian
 * Condition C). Deliberate omissions: confirmBooking (only the inert 2nd step of the
 * create_booking proposal) and cancelBooking (a callable cancel would be an LLM-output→
 * booking mutation, which the L2 invariant forbids). create_booking is PROPOSE-ONLY.
 */
export const TOOLS: readonly Tool[] = [
  searchRatesTool,
  calculateQuoteTool,
  createQuoteTool,
  holdQuoteTool,
  getBookingTool,
  createBookingTool,
];

/** Build the per-service clients from env config (§2.2 — public REST origins only). */
export function createToolClients(env: NodeJS.ProcessEnv = process.env): ToolClients {
  const cfg = loadServiceConfig(env);
  return {
    rates: createRatesClient(cfg.ratesServiceUrl),
    booking: createBookingClient(cfg.bookingServiceUrl),
  };
}
