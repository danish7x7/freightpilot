// HTTP routes for the six §5 endpoints. Handlers validate with Zod, delegate to the
// domain service, and serialize the camelCase/bigint/Date domain rows to the snake_case,
// integer-cents, ISO-string contract shape. No business logic lives here.
import type { FastifyInstance } from "fastify";
import type { Db } from "./db/client.js";
import {
  cancelBooking,
  confirmBooking,
  createBooking,
  createQuote,
  getBooking,
  holdQuote,
  parseActor,
  type Booking,
  type BookingEvent,
  type Quote,
} from "./domain/bookingService.js";
import { ValidationError } from "./domain/errors.js";
import {
  actorRequestSchema,
  createBookingSchema,
  createQuoteSchema,
  idempotencyKeySchema,
  idSchema,
} from "./schemas.js";

const serializeQuote = (q: Quote) => ({
  id: q.id,
  lane_id: q.laneId,
  rate_card_id: q.rateCardId,
  shipment: q.shipment,
  breakdown: q.breakdown,
  // int64 → JSON number: intentional narrowing. Freight totals are far below 2^53, so
  // no precision loss in practice (cents stay integer end to end).
  total_cents: Number(q.totalCents),
  currency: q.currency,
  status: q.status,
  expires_at: q.expiresAt.toISOString(),
  created_at: q.createdAt.toISOString(),
});

const serializeBooking = (b: Booking) => ({
  id: b.id,
  quote_id: b.quoteId,
  shipper_ref: b.shipperRef,
  status: b.status,
  created_at: b.createdAt.toISOString(),
  confirmed_at: b.confirmedAt ? b.confirmedAt.toISOString() : null,
});

const serializeEvent = (e: BookingEvent) => ({
  from_status: e.fromStatus,
  to_status: e.toStatus,
  actor: e.actor,
  metadata: e.metadata ?? null,
  at: e.at.toISOString(),
});

export function registerRoutes(app: FastifyInstance, db: Db): void {
  app.post("/api/v1/quotes", async (request, reply) => {
    const body = createQuoteSchema.parse(request.body);
    const quote = await createQuote(db, {
      laneId: body.lane_id,
      rateCardId: body.rate_card_id,
      shipment: body.shipment,
      breakdown: body.breakdown,
      totalCents: BigInt(body.total_cents),
      currency: body.currency,
    });
    return reply.code(201).send(serializeQuote(quote));
  });

  app.post("/api/v1/quotes/:id/hold", async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    // actor is validated for a uniform request shape though quote holds are not event-logged
    // (no quote_events table by design — see ADR-0005 / booking README).
    actorRequestSchema.parse(request.body);
    const quote = await holdQuote(db, id);
    return reply.code(200).send(serializeQuote(quote));
  });

  app.post("/api/v1/bookings", async (request, reply) => {
    const rawKey = request.headers["idempotency-key"];
    if (typeof rawKey !== "string" || rawKey.length === 0) {
      throw new ValidationError("Idempotency-Key header is required");
    }
    const idempotencyKey = idempotencyKeySchema.parse(rawKey);
    const body = createBookingSchema.parse(request.body);
    const { booking, replayed } = await createBooking(db, {
      quoteId: body.quote_id,
      shipperRef: body.shipper_ref,
      idempotencyKey,
      actor: parseActor(body.actor),
      metadata: body.metadata,
    });
    return reply.code(replayed ? 200 : 201).send(serializeBooking(booking));
  });

  app.post("/api/v1/bookings/:id/confirm", async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = actorRequestSchema.parse(request.body);
    const booking = await confirmBooking(db, id, parseActor(body.actor), body.metadata);
    return reply.code(200).send(serializeBooking(booking));
  });

  app.post("/api/v1/bookings/:id/cancel", async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = actorRequestSchema.parse(request.body);
    const booking = await cancelBooking(db, id, parseActor(body.actor), body.metadata);
    return reply.code(200).send(serializeBooking(booking));
  });

  app.get("/api/v1/bookings/:id", async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const { booking, events } = await getBooking(db, id);
    return reply.code(200).send({ booking: serializeBooking(booking), events: events.map(serializeEvent) });
  });
}
