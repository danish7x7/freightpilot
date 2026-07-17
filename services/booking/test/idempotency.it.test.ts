// Integration test (Testcontainers) — the idempotency-replay DoD, plus the state machine
// driven through the real DB. Runs on CI native Docker; may not launch locally on WSL2
// (see LEARNING.md) — CI is the source of truth, mirroring the rates/booking-L1 ITs.
import { afterAll, beforeAll, expect, test } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type Db } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";
import {
  cancelBooking,
  confirmBooking,
  createBooking,
  createQuote,
  getBooking,
  holdQuote,
} from "../src/domain/bookingService.js";
import { IllegalTransitionError, StateConflictError } from "../src/domain/errors.js";

let container: StartedPostgreSqlContainer;
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  await applyMigrations(container.getConnectionUri());
  ({ db, close } = createDb(container.getConnectionUri()));
}, 120_000);

afterAll(async () => {
  await close?.();
  await container?.stop();
});

async function makeHeldQuote(): Promise<string> {
  const quote = await createQuote(db, {
    laneId: crypto.randomUUID(),
    rateCardId: crypto.randomUUID(),
    shipment: { origin_code: "CNSHA", dest_code: "USOAK", ship_date: "2026-08-01", cargo: { weight_kg: 12000, description: "x" } },
    breakdown: [{ component: "BASE", amount_cents: 268000 }],
    totalCents: 366540n,
    currency: "USD",
  });
  await holdQuote(db, quote.id);
  return quote.id;
}

test("replaying create with the same Idempotency-Key returns the original booking (no double-book)", async () => {
  const quoteId = await makeHeldQuote();
  const key = crypto.randomUUID();

  const first = await createBooking(db, { quoteId, shipperRef: "ACME-1", idempotencyKey: key, actor: "user" });
  const second = await createBooking(db, { quoteId, shipperRef: "ACME-1", idempotencyKey: key, actor: "user" });

  expect(first.replayed).toBe(false);
  expect(second.replayed).toBe(true);
  expect(second.booking.id).toBe(first.booking.id);
  expect(first.booking.status).toBe("HELD"); // Option 2: born QUOTED → HELD in one txn

  // Exactly the birth + hold events — not doubled by the replay.
  const { booking, events } = await getBooking(db, first.booking.id);
  expect(booking.status).toBe("HELD");
  expect(events.map((e) => `${e.fromStatus ?? "null"}->${e.toStatus}`)).toEqual([
    "null->QUOTED",
    "QUOTED->HELD",
  ]);
  expect(events[0].actor).toBe("user");
});

test("two simultaneous creates with the same Idempotency-Key both resolve to the original (never a conflict)", async () => {
  const quoteId = await makeHeldQuote();
  const input = { quoteId, shipperRef: "ACME-3", idempotencyKey: crypto.randomUUID(), actor: "user" as const };

  // Fire both without awaiting the first — the loser must replay, not 409.
  const [a, b] = await Promise.all([createBooking(db, input), createBooking(db, input)]);

  expect(a.booking.id).toBe(b.booking.id);
  expect([a.replayed, b.replayed].sort()).toEqual([false, true]); // exactly one created, one replayed
  const { events } = await getBooking(db, a.booking.id);
  expect(events).toHaveLength(2); // birth + hold, not doubled
});

test("confirm and cancel drive legal transitions; an illegal transition is rejected", async () => {
  const quoteId = await makeHeldQuote();
  const { booking } = await createBooking(db, {
    quoteId,
    shipperRef: "ACME-2",
    idempotencyKey: crypto.randomUUID(),
    actor: "agent",
  });

  const confirmed = await confirmBooking(db, booking.id, "user");
  expect(confirmed.status).toBe("CONFIRMED");
  expect(confirmed.confirmedAt).toBeInstanceOf(Date);

  // Illegal: confirming an already-CONFIRMED booking (no CONFIRMED→CONFIRMED edge).
  await expect(confirmBooking(db, booking.id, "user")).rejects.toBeInstanceOf(IllegalTransitionError);

  // Legal: CONFIRMED → CANCELLED.
  const cancelled = await cancelBooking(db, booking.id, "user");
  expect(cancelled.status).toBe("CANCELLED");

  // The full timeline is appended and ordered.
  const { events } = await getBooking(db, booking.id);
  expect(events.map((e) => e.toStatus)).toEqual(["QUOTED", "HELD", "CONFIRMED", "CANCELLED"]);
});

test("creating a booking from a non-HELD quote is rejected (quote must be HELD)", async () => {
  const quote = await createQuote(db, {
    laneId: crypto.randomUUID(),
    rateCardId: crypto.randomUUID(),
    shipment: { origin_code: "CNSHA", dest_code: "USOAK", ship_date: "2026-08-01", cargo: { weight_kg: 100, description: "x" } },
    breakdown: [],
    totalCents: 1000n,
    currency: "USD",
  });
  // Quote is ACTIVE (never held).
  await expect(
    createBooking(db, { quoteId: quote.id, shipperRef: "X", idempotencyKey: crypto.randomUUID(), actor: "user" }),
  ).rejects.toBeInstanceOf(StateConflictError);
});
