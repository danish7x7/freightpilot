import { z } from "zod";
import { AGENT_ACTOR, toToolResult, type Tool, type ToolClients, type ToolExecution } from "./types.js";
import { shipmentJsonSchema, shipmentSchema } from "./shipment.js";
import { buildCreateBookingProposal } from "./proposal.js";

/**
 * booking-service tools. Dispositions (guardian Condition C):
 *   createQuote, holdQuote, getBooking → live courier tools (quote-domain / read).
 *   createBooking                      → PROPOSE-ONLY (returns inert data, calls nothing).
 *   confirmBooking                     → NOT a tool; only the inert 2nd step of the proposal.
 *   cancelBooking                      → EXCLUDED; a callable cancel is an LLM-output→booking
 *                                        mutation, which the L2 invariant forbids.
 * holdQuote mutates the QUOTE (ACTIVE→HELD), not a booking — permitted live (Flag 1); the
 * create_booking proposal REFERENCES an already-HELD quote, it does not perform the hold.
 */

const breakdownLineSchema = z
  .object({
    component: z.string(),
    calc: z.enum(["FLAT", "PERCENT"]).nullish(),
    rate_bps: z.number().int().nullish(),
    amount_cents: z.number().int(),
  })
  .strict();

// --- create_quote → POST /api/v1/quotes -------------------------------------------------
const createQuoteArgs = z
  .object({
    lane_id: z.string().uuid(),
    rate_card_id: z.string().uuid(),
    shipment: shipmentSchema,
    breakdown: z.array(breakdownLineSchema),
    total_cents: z.number().int(),
    currency: z.string().length(3),
  })
  .strict();

export const createQuoteTool: Tool = {
  name: "create_quote",
  validate: createQuoteArgs,
  schema: {
    name: "create_quote",
    description:
      "Persist a calculated quote (status ACTIVE, expires in 24h). Forward the breakdown/total/currency from calculate_quote and the lane_id/rate_card_id it returned.",
    parameters: {
      type: "object",
      required: ["lane_id", "rate_card_id", "shipment", "breakdown", "total_cents", "currency"],
      properties: {
        lane_id: { type: "string", format: "uuid" },
        rate_card_id: { type: "string", format: "uuid" },
        shipment: shipmentJsonSchema,
        breakdown: {
          type: "array",
          items: {
            type: "object",
            required: ["component", "amount_cents"],
            properties: {
              component: { type: "string" },
              calc: { type: "string", enum: ["FLAT", "PERCENT"] },
              rate_bps: { type: "integer" },
              amount_cents: { type: "integer" },
            },
          },
        },
        total_cents: { type: "integer" },
        currency: { type: "string", minLength: 3, maxLength: 3 },
      },
    },
  },
  async execute(args: unknown, clients: ToolClients): Promise<ToolExecution> {
    const a = args as z.infer<typeof createQuoteArgs>;
    const { data, error, response } = await clients.booking.POST("/api/v1/quotes", { body: a });
    return { kind: "service_result", result: toToolResult(response, data, error) };
  },
};

// --- hold_quote → POST /api/v1/quotes/{id}/hold -----------------------------------------
// actor is FIXED to the agent, never taken from the LLM (the model can't impersonate).
const holdQuoteArgs = z.object({ quote_id: z.string().uuid() }).strict();

export const holdQuoteTool: Tool = {
  name: "hold_quote",
  validate: holdQuoteArgs,
  schema: {
    name: "hold_quote",
    description: "Reserve a quote (ACTIVE→HELD) so it can be booked. Required before create_booking.",
    parameters: {
      type: "object",
      required: ["quote_id"],
      properties: { quote_id: { type: "string", format: "uuid" } },
    },
  },
  async execute(args: unknown, clients: ToolClients): Promise<ToolExecution> {
    const a = args as z.infer<typeof holdQuoteArgs>;
    const { data, error, response } = await clients.booking.POST("/api/v1/quotes/{id}/hold", {
      params: { path: { id: a.quote_id } },
      body: { actor: AGENT_ACTOR },
    });
    return { kind: "service_result", result: toToolResult(response, data, error) };
  },
};

// --- get_booking → GET /api/v1/bookings/{id} --------------------------------------------
const getBookingArgs = z.object({ booking_id: z.string().uuid() }).strict();

export const getBookingTool: Tool = {
  name: "get_booking",
  validate: getBookingArgs,
  schema: {
    name: "get_booking",
    description: "Fetch a booking and its full event timeline by id.",
    parameters: {
      type: "object",
      required: ["booking_id"],
      properties: { booking_id: { type: "string", format: "uuid" } },
    },
  },
  async execute(args: unknown, clients: ToolClients): Promise<ToolExecution> {
    const a = args as z.infer<typeof getBookingArgs>;
    const { data, error, response } = await clients.booking.GET("/api/v1/bookings/{id}", {
      params: { path: { id: a.booking_id } },
    });
    return { kind: "service_result", result: toToolResult(response, data, error) };
  },
};

// --- create_booking → PROPOSE-ONLY (the load-bearing L2 invariant) ----------------------
// Executes NOTHING. Returns inert data modeling ADR-0005's two-call create+confirm. `clients`
// is intentionally UNUSED — there is no code path from here to POST /bookings or /confirm.
const createBookingArgs = z
  .object({
    quote_id: z.string().uuid(),
    shipper_ref: z.string().min(1).max(200),
  })
  .strict();

export const createBookingTool: Tool = {
  name: "create_booking",
  validate: createBookingArgs,
  schema: {
    name: "create_booking",
    description:
      "Propose booking a HELD quote. Returns a proposal for the user to confirm — it does NOT book anything. quote_id must reference a quote already held via hold_quote.",
    parameters: {
      type: "object",
      required: ["quote_id", "shipper_ref"],
      properties: {
        quote_id: { type: "string", format: "uuid", description: "an ALREADY-HELD quote id" },
        shipper_ref: { type: "string", minLength: 1, maxLength: 200, description: "the shipper's reference" },
      },
    },
  },
  // Signature omits `clients` deliberately — there is NO path from here to the network.
  // Returns a resolved Promise of pure data to satisfy the Tool contract; awaits nothing.
  execute(args: unknown): Promise<ToolExecution> {
    const a = args as z.infer<typeof createBookingArgs>;
    return Promise.resolve({ kind: "proposal", proposal: buildCreateBookingProposal(a) });
  },
};
