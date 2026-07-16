// Integration test (Testcontainers) — the booking data-layer DoD proof: migrations
// apply cleanly to a real Postgres and the schema behaves. Runs on CI native Docker;
// may not launch locally on WSL2 + Docker Desktop (docker-java/dockerode CLI-proxy
// quirk, see LEARNING.md) — CI is the source of truth, mirroring the rates L1/L2 ITs.
import { afterAll, beforeAll, expect, test } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../src/db/schema.js";

let container: StartedPostgreSqlContainer;
let client: ReturnType<typeof postgres>;
let db: PostgresJsDatabase<typeof schema>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  client = postgres(container.getConnectionUri(), { max: 1 });
  db = drizzle(client, { schema });
  // This is the "migrations apply cleanly" assertion — a failure throws here.
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 120_000);

afterAll(async () => {
  await client?.end();
  await container?.stop();
});

test("quote → booking → booking_event chain inserts, defaults apply, and joins", async () => {
  const [quote] = await db
    .insert(schema.quotes)
    .values({
      laneId: crypto.randomUUID(),
      rateCardId: crypto.randomUUID(),
      shipment: { origin_code: "CNSHA", dest_code: "USOAK", cargo: { weight_kg: 12000 } },
      breakdown: [
        { component: "BASE", amount_cents: 268000 },
        { component: "FUEL", amount_cents: 41540 },
      ],
      totalCents: 366540n, // bigint mode round-trips
      currency: "USD",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returning();

  expect(quote.status).toBe("ACTIVE"); // enum default
  expect(quote.totalCents).toBe(366540n);
  expect(quote.createdAt).toBeInstanceOf(Date); // timestamptz mode:'date'

  const [booking] = await db
    .insert(schema.bookings)
    .values({ quoteId: quote.id, shipperRef: "ACME-001", idempotencyKey: "idem-key-1" })
    .returning();

  expect(booking.status).toBe("QUOTED"); // enum default

  await db.insert(schema.bookingEvents).values({
    bookingId: booking.id,
    fromStatus: null,
    toStatus: "QUOTED",
    actor: "user",
    metadata: { note: "created via test" },
  });

  const events = await db
    .select()
    .from(schema.bookingEvents)
    .where(eq(schema.bookingEvents.bookingId, booking.id));

  expect(events).toHaveLength(1);
  expect(events[0].toStatus).toBe("QUOTED");
  expect(events[0].actor).toBe("user");
});

test("idempotency_key UNIQUE rejects a duplicate booking", async () => {
  const [quote] = await db
    .insert(schema.quotes)
    .values({
      laneId: crypto.randomUUID(),
      rateCardId: crypto.randomUUID(),
      shipment: {},
      breakdown: [],
      totalCents: 100000n,
      currency: "USD",
      expiresAt: new Date(Date.now() + 3600_000),
    })
    .returning();

  const dupKey = "idem-dup";
  await db
    .insert(schema.bookings)
    .values({ quoteId: quote.id, shipperRef: "A", idempotencyKey: dupKey });

  await expect(
    db.insert(schema.bookings).values({ quoteId: quote.id, shipperRef: "B", idempotencyKey: dupKey }),
  ).rejects.toThrow();
});

test("cross-service lane_id / rate_card_id accept arbitrary UUIDs (no hard FK)", async () => {
  // Rule 1 guard: these reference rates-service data by convention only — an id that
  // exists in no local table must still insert, proving there is no cross-service FK.
  const laneId = crypto.randomUUID();
  const [quote] = await db
    .insert(schema.quotes)
    .values({
      laneId,
      rateCardId: crypto.randomUUID(),
      shipment: {},
      breakdown: [],
      totalCents: 1n,
      currency: "USD",
      expiresAt: new Date(Date.now() + 3600_000),
    })
    .returning();

  // Re-select to prove it persisted (not just that the insert didn't throw).
  const [refetched] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quote.id));
  expect(refetched.laneId).toBe(laneId);
});

test("booking with an unknown quote_id is rejected by the intra-DB FK", async () => {
  // Symmetric to the test above: the SAME-DB FKs must be live, so a dangling quote_id
  // fails. Guards against someone dropping the `.references()` on quote_id.
  await expect(
    db
      .insert(schema.bookings)
      .values({ quoteId: crypto.randomUUID(), shipperRef: "X", idempotencyKey: "fk-orphan" }),
  ).rejects.toThrow();
});
