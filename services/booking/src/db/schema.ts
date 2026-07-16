// booking-service data model (MASTER_PLAN §4.2). Column modes are pinned per the
// architecture review: money is integer cents as bigint, timestamps are timezone-aware
// Date, currency is CHAR(3) with NO default (snapshotted from the quote). The enums are
// deliberately PERMISSIVE — legal transition ordering is enforced by the L2
// BookingStateMachine (a single class), never by a DB CHECK/trigger (§2.2 / Rule 3).
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  char,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const quoteStatus = pgEnum("quote_status", ["ACTIVE", "HELD", "EXPIRED", "CONSUMED"]);
export const bookingStatus = pgEnum("booking_status", [
  "QUOTED",
  "HELD",
  "CONFIRMED",
  "DOCUMENTS_ISSUED",
  "EXPIRED",
  "CANCELLED",
]);
export const actor = pgEnum("actor", ["user", "agent", "system"]);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const quotes = pgTable("quotes", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  // Cross-service references (rates-service owns these). FK BY CONVENTION ONLY — no
  // hard FK across databases (§2.2: cross-service data flows through REST contracts).
  laneId: uuid("lane_id").notNull(),
  rateCardId: uuid("rate_card_id").notNull(),
  // Opaque snapshots of rates data crossing the service boundary; validated upstream,
  // stored verbatim here. The shared schema owns their shape at L2/L3, not this layer.
  shipment: jsonb("shipment").notNull(),
  breakdown: jsonb("breakdown").notNull(),
  totalCents: bigint("total_cents", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: quoteStatus("status").notNull().default("ACTIVE"),
  expiresAt: timestamptz("expires_at").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const bookings = pgTable("bookings", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  // Intra-DB hard FK — allowed and correct (same database, not cross-service).
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id),
  shipperRef: text("shipper_ref").notNull(),
  status: bookingStatus("status").notNull().default("QUOTED"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  confirmedAt: timestamptz("confirmed_at"),
});

export const bookingEvents = pgTable("booking_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  fromStatus: bookingStatus("from_status"),
  toStatus: bookingStatus("to_status").notNull(),
  actor: actor("actor").notNull(),
  metadata: jsonb("metadata"),
  at: timestamptz("at").notNull().defaultNow(),
});
