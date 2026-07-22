// agent-service data model (MASTER_PLAN §6.3.2). Agent-service's FIRST table — the
// confirmation gate (§6.3.2): the model can only PROPOSE create_booking; agent-service
// writes a `confirmations` row and only a user's click on the token executes the booking.
//
// OWNED BY agent-service. `quote_id` / `booking_id` reference booking-service rows —
// FK BY CONVENTION ONLY, no cross-service hard FK (§2.2: cross-service data flows through
// REST, and each service owns its DB).
import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Gate lifecycle: minted `pending` → `consumed` on the single-use redeem claim; `expired` past TTL. */
export const confirmationStatus = pgEnum("confirmation_status", ["pending", "consumed", "expired"]);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const confirmations = pgTable("confirmations", {
  // Public, NON-secret reference used in logs + stamped into booking_events metadata. Distinct
  // from `token` so the secret credential never leaks into logs or booking-service (Condition F).
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  // The SECRET credential. Crypto-random, high-entropy (Condition F). Possession == authorization
  // (auth is a Non-Goal). Doubles as the create Idempotency-Key (§6.3.2 / ADR-0005).
  token: text("token").notNull().unique(),

  // Server-authoritative proposal payload (Condition A). The redeem call carries ONLY the token;
  // these are never resent by the client, so the token authorizes THIS booking, not "a booking".
  quoteId: uuid("quote_id").notNull(),
  shipperRef: text("shipper_ref").notNull(),
  actor: text("actor").notNull().default("agent"),

  status: confirmationStatus("status").notNull().default("pending"),
  conversationId: text("conversation_id"), // provenance (nullable)

  // Post-execution result — set once the redeem executes, so a double-redeem loser (or a re-GET)
  // returns the stored outcome without re-hitting booking-service.
  bookingId: uuid("booking_id"),
  finalStatus: text("final_status"),
  executionMeta: jsonb("execution_meta"), // partial-failure detail (e.g. held-not-confirmed)

  createdAt: timestamptz("created_at").notNull().defaultNow(),
  expiresAt: timestamptz("expires_at").notNull(),
  consumedAt: timestamptz("consumed_at"),
});
