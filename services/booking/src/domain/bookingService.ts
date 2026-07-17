// Domain service: the ONE module that mutates booking/quote state. Every booking_status
// change goes through applyTransition → the state machine + an atomic booking_events row,
// so "no mutation outside the machine" holds by construction (§2.4, Rule 3). Money and
// dates are passed through verbatim — booking-service does no rate math (§2.2).
import { asc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { actor as actorEnum, bookingEvents, bookings, quotes } from "../db/schema.js";
import { NotFoundError, StateConflictError, ValidationError } from "./errors.js";
import { assertQuoteTransition } from "./quoteStatus.js";
import { BookingStateMachine, bookingStateMachine, type BookingStatus } from "./stateMachine.js";

export type Actor = (typeof actorEnum.enumValues)[number];
export type Quote = InferSelectModel<typeof quotes>;
export type Booking = InferSelectModel<typeof bookings>;
export type BookingEvent = InferSelectModel<typeof bookingEvents>;

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const QUOTE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreateQuoteInput {
  laneId: string;
  rateCardId: string;
  shipment: unknown;
  breakdown: unknown;
  totalCents: bigint;
  currency: string;
}

export interface CreateBookingInput {
  quoteId: string;
  shipperRef: string;
  idempotencyKey: string;
  actor: Actor;
  metadata?: Record<string, unknown>;
}

/** THE single status-mutation point: validate via the machine, write status + event atomically. */
async function applyTransition(
  tx: Tx,
  bookingId: string,
  from: BookingStatus | null,
  to: BookingStatus,
  actor: Actor,
  metadata?: Record<string, unknown>,
): Promise<void> {
  bookingStateMachine.assertTransition(from, to);
  if (from !== null) {
    await tx
      .update(bookings)
      .set({ status: to, ...(to === "CONFIRMED" ? { confirmedAt: new Date() } : {}) })
      .where(eq(bookings.id, bookingId));
  }
  await tx.insert(bookingEvents).values({
    bookingId,
    fromStatus: from,
    toStatus: to,
    actor,
    metadata: metadata ?? null,
  });
}

export async function createQuote(db: Db, input: CreateQuoteInput): Promise<Quote> {
  const [quote] = await db
    .insert(quotes)
    .values({
      laneId: input.laneId,
      rateCardId: input.rateCardId,
      shipment: input.shipment,
      breakdown: input.breakdown,
      totalCents: input.totalCents,
      currency: input.currency,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    })
    .returning();
  return quote;
}

export async function holdQuote(db: Db, quoteId: string): Promise<Quote> {
  return db.transaction(async (tx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
    if (!quote) throw new NotFoundError(`Quote ${quoteId} not found`);
    if (quote.status === "HELD") return quote; // idempotent re-hold
    assertQuoteTransition(quote.status, "HELD");
    const [held] = await tx
      .update(quotes)
      .set({ status: "HELD" })
      .where(eq(quotes.id, quoteId))
      .returning();
    return held;
  });
}

/**
 * Create a booking from a HELD quote, idempotent on Idempotency-Key. Option 2 (ADR-0005):
 * the booking is born QUOTED then transitioned QUOTED→HELD in the same transaction (two
 * events), and the quote is CONSUMED. Replaying the same key returns the original (no new row).
 */
export async function createBooking(
  db: Db,
  input: CreateBookingInput,
): Promise<{ booking: Booking; replayed: boolean }> {
  // Fast idempotent-replay path: return an existing booking for this key BEFORE the quote
  // precondition — the first booking CONSUMES the quote, so a replay's quote is no longer
  // HELD and would otherwise wrongly fail. The UNIQUE(idempotency_key) constraint + the
  // catch below remain the race-safe serialization point for concurrent first-time submits.
  const prior = await db.query.bookings.findFirst({
    where: eq(bookings.idempotencyKey, input.idempotencyKey),
  });
  if (prior) return { booking: prior, replayed: true };

  try {
    const booking = await db.transaction(async (tx) => {
      const [quote] = await tx
        .select()
        .from(quotes)
        .where(eq(quotes.id, input.quoteId))
        .for("update");
      if (!quote) throw new NotFoundError(`Quote ${input.quoteId} not found`);
      if (quote.status !== "HELD") {
        throw new StateConflictError(`Quote ${input.quoteId} must be HELD to book (is ${quote.status})`);
      }

      // Birth at the machine's INITIAL state, then QUOTED→HELD — both events atomic.
      // This insert is the ONE intentional exception to "status is only written by
      // applyTransition": the birth row is created AT INITIAL (using the machine's own
      // constant), and applyTransition(null → INITIAL) then asserts + logs the birth event
      // (its from===null branch writes no status). Keep the insert's status = INITIAL.
      const [created] = await tx
        .insert(bookings)
        .values({
          quoteId: input.quoteId,
          shipperRef: input.shipperRef,
          idempotencyKey: input.idempotencyKey,
          status: BookingStateMachine.INITIAL,
        })
        .returning();
      await applyTransition(tx, created.id, null, BookingStateMachine.INITIAL, input.actor, input.metadata);
      await applyTransition(tx, created.id, BookingStateMachine.INITIAL, "HELD", input.actor);

      // Consume the quote so it can't be booked twice.
      assertQuoteTransition(quote.status, "CONSUMED");
      await tx.update(quotes).set({ status: "CONSUMED" }).where(eq(quotes.id, input.quoteId));

      const [final] = await tx.select().from(bookings).where(eq(bookings.id, created.id));
      return final;
    });
    return { booking, replayed: false };
  } catch (err) {
    // Idempotent replay under concurrency: a same-key create that loses the race fails one
    // of two ways — the UNIQUE(idempotency_key) constraint (23505), or, for the same-quote
    // case, the quote-HELD precondition (the winner already CONSUMED the quote, so the loser
    // sees StateConflict). In BOTH cases, if a booking already exists for this key it's a
    // replay → return the original. Only a genuinely-unbookable quote with NO prior booking
    // for this key is a real StateConflict. First-write-wins (ADR-0005, §5).
    if (isUniqueViolation(err, "idempotency_key") || err instanceof StateConflictError) {
      const existing = await db.query.bookings.findFirst({
        where: eq(bookings.idempotencyKey, input.idempotencyKey),
      });
      if (existing) return { booking: existing, replayed: true };
    }
    throw err;
  }
}

export async function confirmBooking(
  db: Db,
  bookingId: string,
  actor: Actor,
  metadata?: Record<string, unknown>,
): Promise<Booking> {
  return transitionExistingBooking(db, bookingId, "CONFIRMED", actor, metadata);
}

export async function cancelBooking(
  db: Db,
  bookingId: string,
  actor: Actor,
  metadata?: Record<string, unknown>,
): Promise<Booking> {
  return transitionExistingBooking(db, bookingId, "CANCELLED", actor, metadata);
}

async function transitionExistingBooking(
  db: Db,
  bookingId: string,
  to: BookingStatus,
  actor: Actor,
  metadata?: Record<string, unknown>,
): Promise<Booking> {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update");
    if (!booking) throw new NotFoundError(`Booking ${bookingId} not found`);
    await applyTransition(tx, bookingId, booking.status, to, actor, metadata);
    const [updated] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    return updated;
  });
}

export async function getBooking(
  db: Db,
  bookingId: string,
): Promise<{ booking: Booking; events: BookingEvent[] }> {
  const booking = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  if (!booking) throw new NotFoundError(`Booking ${bookingId} not found`);
  const events = await db
    .select()
    .from(bookingEvents)
    .where(eq(bookingEvents.bookingId, bookingId))
    .orderBy(asc(bookingEvents.id));
  return { booking, events };
}

/** True for a Postgres unique-violation (SQLSTATE 23505) on the named constraint/column. */
function isUniqueViolation(err: unknown, constraintSubstring?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint_name?: string };
  if (e.code !== "23505") return false;
  return !constraintSubstring || (e.constraint_name?.includes(constraintSubstring) ?? false);
}

/** Validates a raw string is a known actor enum value (used by the route layer). */
export function parseActor(value: unknown): Actor {
  if (typeof value === "string" && (actorEnum.enumValues as readonly string[]).includes(value)) {
    return value as Actor;
  }
  throw new ValidationError("actor must be one of user, agent, system", [`actor=${String(value)}`]);
}
