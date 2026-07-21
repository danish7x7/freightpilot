import { z } from "zod";

/**
 * Shared ShipmentSpec / Cargo shapes (contracts §5 — the identical shape rates + booking
 * consume; "do not fork"). Kept once here and reused by calculate_quote and create_quote so
 * the two tools validate shipments identically. UN/LOCODE codes are exactly 5 chars.
 */
/** Shared so the search `mode` enum and shipment `mode` enum cannot drift apart. */
export const MODES = ["OCEAN", "AIR", "TRUCK"] as const;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const cargoSchema = z
  .object({
    pallets: z.number().int().min(1).max(100).optional(),
    weight_kg: z.number().gt(0).max(30000),
    volume_cbm: z.number().gt(0).optional(),
    description: z.string().max(500),
  })
  .strict();

export const shipmentSchema = z
  .object({
    origin_code: z.string().length(5),
    dest_code: z.string().length(5),
    mode: z.enum(MODES).optional(),
    ship_date: z.string().regex(ISO_DATE, "must be an ISO date (YYYY-MM-DD)"),
    deliver_by: z.string().regex(ISO_DATE, "must be an ISO date (YYYY-MM-DD)").optional(),
    cargo: cargoSchema,
  })
  .strict();

/** JSON-Schema fragment for the LLM (mirrors shipmentSchema; handed to the model as a tool param). */
export const shipmentJsonSchema = {
  type: "object",
  required: ["origin_code", "dest_code", "ship_date", "cargo"],
  properties: {
    origin_code: { type: "string", minLength: 5, maxLength: 5, description: "5-char UN/LOCODE origin, e.g. CNSHA" },
    dest_code: { type: "string", minLength: 5, maxLength: 5, description: "5-char UN/LOCODE destination, e.g. USOAK" },
    mode: { type: "string", enum: [...MODES] },
    ship_date: { type: "string", format: "date", description: "ISO date YYYY-MM-DD" },
    deliver_by: { type: "string", format: "date" },
    cargo: {
      type: "object",
      required: ["weight_kg", "description"],
      properties: {
        pallets: { type: "integer", minimum: 1, maximum: 100 },
        weight_kg: { type: "number", exclusiveMinimum: 0, maximum: 30000 },
        volume_cbm: { type: "number", exclusiveMinimum: 0 },
        description: { type: "string", maxLength: 500 },
      },
    },
  },
} as const;
