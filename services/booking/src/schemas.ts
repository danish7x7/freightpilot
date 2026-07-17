// Zod request schemas — the validation boundary for the routes. Snake_case matches the
// OpenAPI contract; the route layer maps to the camelCase domain. shipment/breakdown are
// snapshots validated only structurally (booking does no rate math — §2.2).
import { z } from "zod";

export const actorSchema = z.enum(["user", "agent", "system"]);
const metadataSchema = z.record(z.string(), z.unknown()).optional();

const cargoSchema = z
  // description bounded to match the contract (Cargo.description maxLength 500) — caps the
  // unbounded-JSONB storage vector flagged in security review.
  .object({ weight_kg: z.number(), description: z.string().max(500) })
  .passthrough();

const shipmentSchema = z
  .object({
    origin_code: z.string(),
    dest_code: z.string(),
    ship_date: z.string(),
    cargo: cargoSchema,
  })
  .passthrough();

const breakdownLineSchema = z
  .object({ component: z.string(), amount_cents: z.number().int() })
  .passthrough();

export const createQuoteSchema = z.object({
  lane_id: z.string().uuid(),
  rate_card_id: z.string().uuid(),
  shipment: shipmentSchema,
  breakdown: z.array(breakdownLineSchema).max(50), // a quote has a handful of surcharge lines
  total_cents: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export const actorRequestSchema = z.object({
  actor: actorSchema,
  metadata: metadataSchema,
});

export const createBookingSchema = z.object({
  quote_id: z.string().uuid(),
  shipper_ref: z.string().min(1).max(200),
  actor: actorSchema,
  metadata: metadataSchema,
});

export const idSchema = z.string().uuid();

// Bound the Idempotency-Key server-side to the contract's maxLength (200). Without this an
// over-long key hits Postgres' btree index-row-size limit and surfaces as a generic 500.
export const idempotencyKeySchema = z.string().min(1).max(200);
