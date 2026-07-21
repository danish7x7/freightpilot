import { z } from "zod";
import type { Tool, ToolClients, ToolExecution } from "./types.js";
import { toToolResult } from "./types.js";
import { ISO_DATE, MODES, shipmentJsonSchema, shipmentSchema } from "./shipment.js";

/**
 * rates-service tools — 1:1 with its two public endpoints (searchRates, calculateQuote).
 * Thin couriers: each forwards its ONE endpoint's response verbatim and re-implements no
 * rate math (rates-service owns that, §2.2). Both are reads/quotes — safe to call live.
 */

// --- search_rates → GET /api/v1/rates/search --------------------------------------------
const searchRatesArgs = z
  .object({
    origin: z.string().length(5),
    dest: z.string().length(5),
    mode: z.enum(MODES),
    ship_date: z.string().regex(ISO_DATE, "must be an ISO date (YYYY-MM-DD)"),
  })
  .strict();

export const searchRatesTool: Tool = {
  name: "search_rates",
  validate: searchRatesArgs,
  schema: {
    name: "search_rates",
    description: "Find rate cards valid for a ship date on a lane (origin→destination, mode).",
    parameters: {
      type: "object",
      required: ["origin", "dest", "mode", "ship_date"],
      properties: {
        origin: { type: "string", minLength: 5, maxLength: 5, description: "5-char UN/LOCODE origin" },
        dest: { type: "string", minLength: 5, maxLength: 5, description: "5-char UN/LOCODE destination" },
        mode: { type: "string", enum: [...MODES] },
        ship_date: { type: "string", format: "date", description: "ISO date YYYY-MM-DD" },
      },
    },
  },
  async execute(args: unknown, clients: ToolClients): Promise<ToolExecution> {
    const a = args as z.infer<typeof searchRatesArgs>;
    const { data, error, response } = await clients.rates.GET("/api/v1/rates/search", {
      params: { query: { origin: a.origin, dest: a.dest, mode: a.mode, ship_date: a.ship_date } },
    });
    return { kind: "service_result", result: toToolResult(response, data, error) };
  },
};

// --- calculate_quote → POST /api/v1/quotes/calculate ------------------------------------
const calculateQuoteArgs = z
  .object({
    rate_card_id: z.string().uuid(),
    shipment: shipmentSchema,
  })
  .strict();

export const calculateQuoteTool: Tool = {
  name: "calculate_quote",
  validate: calculateQuoteArgs,
  schema: {
    name: "calculate_quote",
    description:
      "Compute the full quote (base cost + surcharge breakdown) for a rate card and shipment. Pure — persists nothing.",
    parameters: {
      type: "object",
      required: ["rate_card_id", "shipment"],
      properties: {
        rate_card_id: { type: "string", format: "uuid", description: "id from a search_rates result" },
        shipment: shipmentJsonSchema,
      },
    },
  },
  async execute(args: unknown, clients: ToolClients): Promise<ToolExecution> {
    const a = args as z.infer<typeof calculateQuoteArgs>;
    const { data, error, response } = await clients.rates.POST("/api/v1/quotes/calculate", {
      body: { rate_card_id: a.rate_card_id, shipment: a.shipment },
    });
    return { kind: "service_result", result: toToolResult(response, data, error) };
  },
};
