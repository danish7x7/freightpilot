// Route-level integration test (Testcontainers + Fastify inject) — exercises the HTTP
// surface: contract serialization (snake_case / integer cents / ISO), the {code,message,
// details} envelope, replay 201-vs-200, validation, and X-Request-Id. Runs on CI Docker.
import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { buildApp } from "../src/app.js";
import { createDb, type Db } from "../src/db/client.js";
import { applyMigrations } from "../src/db/migrate.js";

let container: StartedPostgreSqlContainer;
let db: Db;
let close: () => Promise<void>;
let app: FastifyInstance;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  await applyMigrations(container.getConnectionUri());
  ({ db, close } = createDb(container.getConnectionUri()));
  app = buildApp(db);
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await close?.();
  await container?.stop();
});

const quoteBody = {
  lane_id: crypto.randomUUID(),
  rate_card_id: crypto.randomUUID(),
  shipment: {
    origin_code: "CNSHA",
    dest_code: "USOAK",
    ship_date: "2026-08-01",
    cargo: { weight_kg: 12000, description: "general cargo" },
  },
  breakdown: [{ component: "BASE", amount_cents: 268000 }],
  total_cents: 366540,
  currency: "USD",
};

async function createHeldQuote(): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/v1/quotes", payload: quoteBody });
  const id = res.json().id as string;
  await app.inject({ method: "POST", url: `/api/v1/quotes/${id}/hold`, payload: { actor: "user" } });
  return id;
}

test("POST /quotes serializes to the snake_case / integer-cents contract shape (201)", async () => {
  const res = await app.inject({ method: "POST", url: "/api/v1/quotes", payload: quoteBody });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  expect(body).toMatchObject({
    lane_id: quoteBody.lane_id,
    rate_card_id: quoteBody.rate_card_id,
    total_cents: 366540,
    currency: "USD",
    status: "ACTIVE",
  });
  expect(typeof body.expires_at).toBe("string");
  expect(res.headers["x-request-id"]).toBeTruthy();
});

test("missing Idempotency-Key returns a 400 VALIDATION_ERROR envelope", async () => {
  const quoteId = await createHeldQuote();
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/bookings",
    payload: { quote_id: quoteId, shipper_ref: "X", actor: "user" },
  });
  expect(res.statusCode).toBe(400);
  const body = res.json();
  expect(body.code).toBe("VALIDATION_ERROR");
  expect(Array.isArray(body.details)).toBe(true);
});

test("first create is 201, replay with the same key is 200 with the same id", async () => {
  const quoteId = await createHeldQuote();
  const headers = { "idempotency-key": crypto.randomUUID() };
  const payload = { quote_id: quoteId, shipper_ref: "ACME", actor: "user" };
  const first = await app.inject({ method: "POST", url: "/api/v1/bookings", headers, payload });
  const replay = await app.inject({ method: "POST", url: "/api/v1/bookings", headers, payload });
  expect(first.statusCode).toBe(201);
  expect(first.json().status).toBe("HELD");
  expect(replay.statusCode).toBe(200);
  expect(replay.json().id).toBe(first.json().id);
});

test("an illegal transition returns a 409 ILLEGAL_TRANSITION envelope", async () => {
  const quoteId = await createHeldQuote();
  const headers = { "idempotency-key": crypto.randomUUID() };
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/bookings",
    headers,
    payload: { quote_id: quoteId, shipper_ref: "X", actor: "user" },
  });
  const id = created.json().id as string;
  await app.inject({ method: "POST", url: `/api/v1/bookings/${id}/confirm`, payload: { actor: "user" } });
  const again = await app.inject({
    method: "POST",
    url: `/api/v1/bookings/${id}/confirm`,
    payload: { actor: "user" },
  });
  expect(again.statusCode).toBe(409);
  expect(again.json().code).toBe("ILLEGAL_TRANSITION");
});

test("holding an already-HELD quote is a no-op that returns HELD", async () => {
  const res = await app.inject({ method: "POST", url: "/api/v1/quotes", payload: quoteBody });
  const id = res.json().id as string;
  const h1 = await app.inject({ method: "POST", url: `/api/v1/quotes/${id}/hold`, payload: { actor: "user" } });
  const h2 = await app.inject({ method: "POST", url: `/api/v1/quotes/${id}/hold`, payload: { actor: "user" } });
  expect(h1.json().status).toBe("HELD");
  expect(h2.statusCode).toBe(200);
  expect(h2.json().status).toBe("HELD");
});

test("GET /bookings/{id} returns the booking + ordered event timeline", async () => {
  const quoteId = await createHeldQuote();
  const headers = { "idempotency-key": crypto.randomUUID() };
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/bookings",
    headers,
    payload: { quote_id: quoteId, shipper_ref: "X", actor: "agent" },
  });
  const id = created.json().id as string;
  const res = await app.inject({ method: "GET", url: `/api/v1/bookings/${id}` });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.booking.id).toBe(id);
  expect(body.events.map((e: { to_status: string }) => e.to_status)).toEqual(["QUOTED", "HELD"]);
  expect(body.events[0].from_status).toBeNull();
});

test("X-Request-Id is echoed when valid, minted when absent", async () => {
  const echoed = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "abc-123" } });
  expect(echoed.headers["x-request-id"]).toBe("abc-123");
  const minted = await app.inject({ method: "GET", url: "/health" });
  expect(String(minted.headers["x-request-id"])).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
});
