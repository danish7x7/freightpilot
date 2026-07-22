// Integration test (Testcontainers) — the confirmation gate against a REAL Postgres. Covers
// the single-use claim under genuine concurrency (Condition B), redeem execution + partial
// failure (Condition D), audit provenance (Condition E), and the HTTP routes. Booking-service
// HTTP is mocked at the undici boundary (postgres uses TCP, unaffected). Runs on CI native
// Docker; may not launch locally on WSL2 (see LEARNING.md) — CI is the source of truth.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from "undici";
import { createDb, type Db } from "../../src/db/client.js";
import { applyMigrations } from "../../src/db/migrate.js";
import { createBookingClient } from "../../src/api/booking.js";
import { buildApp } from "../../src/app.js";
import { claimForRedemption, findByToken, mintConfirmation } from "../../src/gate/confirmationStore.js";
import { propose, redeem, type GateDeps } from "../../src/gate/gateService.js";
import { buildCreateBookingProposal } from "../../src/tools/proposal.js";

const BOOKING = "http://booking-service:8081";
const QUOTE = "22222222-2222-2222-2222-222222222222";
const BID = "33333333-3333-3333-3333-333333333333";

let container: StartedPostgreSqlContainer;
let db: Db;
let close: () => Promise<void>;
let original: Dispatcher;
let mock: MockAgent;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  await applyMigrations(container.getConnectionUri());
  ({ db, close } = createDb(container.getConnectionUri()));
}, 120_000);

afterAll(async () => {
  await close?.();
  await container?.stop();
});

beforeEach(() => {
  original = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect(); // any un-mocked booking call throws; postgres (TCP) is unaffected
  setGlobalDispatcher(mock);
});
afterEach(async () => {
  setGlobalDispatcher(original);
  await mock.close();
});

function deps(): GateDeps {
  return { db, booking: createBookingClient(BOOKING) };
}
const proposal = () => buildCreateBookingProposal({ quote_id: QUOTE, shipper_ref: "PO-1" });

function interceptCreate(status: number, body: unknown, assertBody?: (b: Record<string, unknown>) => boolean) {
  mock
    .get(BOOKING)
    .intercept({ path: "/api/v1/bookings", method: "POST", body: (raw) => (assertBody ? assertBody(JSON.parse(raw)) : true) })
    .reply(status, body as object);
}
function interceptConfirm(reply: { status: number; body: unknown } | { error: Error }) {
  const i = mock.get(BOOKING).intercept({
    path: `/api/v1/bookings/${BID}/confirm`,
    method: "POST",
    // Condition E: confirm body carries actor=agent + gate provenance, same as create.
    body: (raw) => {
      const b = JSON.parse(raw);
      return b.actor === "agent" && (b.metadata as Record<string, unknown>)?.source === "agent_gate";
    },
  });
  if ("error" in reply) i.replyWithError(reply.error);
  else i.reply(reply.status, reply.body as object);
}
function interceptGet(status: string) {
  mock.get(BOOKING).intercept({ path: `/api/v1/bookings/${BID}`, method: "GET" }).reply(200, { booking: { id: BID, status }, events: [] });
}

describe("confirmation store + gate (real Postgres)", () => {
  test("mint writes a pending row with a high-entropy token and 10-min TTL", async () => {
    const row = await mintConfirmation(db, { quoteId: QUOTE, shipperRef: "PO-1", conversationId: "conv-1" });
    expect(row.status).toBe("pending");
    expect(row.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.quoteId).toBe(QUOTE);
    const ttlMs = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttlMs).toBeGreaterThan(9 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });

  test("Condition B: concurrent claims — exactly one wins, the other gets nothing", async () => {
    const row = await mintConfirmation(db, { quoteId: QUOTE, shipperRef: "PO-1" });
    const [a, b] = await Promise.all([
      claimForRedemption(db, row.token),
      claimForRedemption(db, row.token),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    const after = await findByToken(db, row.token);
    expect(after?.status).toBe("consumed");
  });

  test("redeem happy path: create 201 + confirm 200 → confirmed, result recorded, actor+provenance stamped (Condition E)", async () => {
    const { token, card } = await propose(deps(), proposal(), { conversationId: "conv-42" });
    expect(card.status).toBe("pending");

    // Assert BOTH the Idempotency-Key=token reuse and the audit provenance on the create body.
    interceptCreate(201, { id: BID, status: "HELD" }, (b) => {
      return (
        b.actor === "agent" &&
        (b.metadata as Record<string, unknown>)?.source === "agent_gate" &&
        (b.metadata as Record<string, unknown>)?.conversation_id === "conv-42" &&
        typeof (b.metadata as Record<string, unknown>)?.confirmation_id === "string"
      );
    });
    interceptConfirm({ status: 200, body: { id: BID, status: "CONFIRMED" } });

    const result = await redeem(deps(), token);
    expect(result).toMatchObject({ status: "confirmed", booking_id: BID, final_status: "CONFIRMED", replayed: false });

    const row = await findByToken(db, token);
    expect(row?.status).toBe("consumed");
    expect(row?.bookingId).toBe(BID);
    expect(row?.finalStatus).toBe("CONFIRMED");
    expect(mock.pendingInterceptors()).toHaveLength(0); // exactly one create + one confirm consumed
  });

  test("double-redeem (sequential): second returns the stored result WITHOUT re-executing", async () => {
    const { token } = await propose(deps(), proposal());
    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ status: 200, body: { id: BID, status: "CONFIRMED" } });

    const first = await redeem(deps(), token);
    // No new interceptors for the second call — if it tried to execute, disableNetConnect throws.
    const second = await redeem(deps(), token);

    expect(first).toMatchObject({ status: "confirmed", replayed: false });
    expect(second).toMatchObject({ status: "confirmed", booking_id: BID, replayed: true });
  });

  test("Condition B: concurrent double-redeem — at most one executes (interceptor exhaustion proves it)", async () => {
    const { token } = await propose(deps(), proposal());
    // Provide exactly ONE create + ONE confirm. A second execution would find no interceptor → throw.
    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ status: 200, body: { id: BID, status: "CONFIRMED" } });

    const [a, b] = await Promise.all([redeem(deps(), token), redeem(deps(), token)]);
    const statuses = [a.status, b.status];
    expect(statuses).toContain("confirmed");
    // The loser is either confirmed (winner finished first) or in_progress (winner mid-flight).
    expect(statuses.every((s) => s === "confirmed" || s === "in_progress")).toBe(true);
  });

  test("expired token → ConfirmationExpiredError, row marked expired", async () => {
    const row = await mintConfirmation(db, { quoteId: QUOTE, shipperRef: "PO-1", ttlMs: -1 });
    await expect(redeem(deps(), row.token)).rejects.toMatchObject({ code: "CONFIRMATION_EXPIRED" });
    const after = await findByToken(db, row.token);
    expect(after?.status).toBe("expired");
  });

  test("unknown token → ConfirmationNotFoundError", async () => {
    await expect(redeem(deps(), "nonexistent-token")).rejects.toMatchObject({ code: "CONFIRMATION_NOT_FOUND" });
  });

  test("Condition D: create 409 (quote consumed/expired) → QuoteUnavailableError, recorded as spent", async () => {
    const { token } = await propose(deps(), proposal());
    interceptCreate(409, { code: "STATE_CONFLICT", message: "quote not HELD", details: [] });

    await expect(redeem(deps(), token)).rejects.toMatchObject({ code: "QUOTE_UNAVAILABLE" });
    const row = await findByToken(db, token);
    expect(row?.status).toBe("consumed");
    expect(row?.finalStatus).toBe("QUOTE_UNAVAILABLE");
  });

  test("Condition D: create 5xx → EXECUTION_FAILED recorded; re-redeem surfaces the error, not in_progress", async () => {
    const { token } = await propose(deps(), proposal());
    interceptCreate(503, { code: "INTERNAL_ERROR", message: "overloaded", details: [] });

    await expect(redeem(deps(), token)).rejects.toMatchObject({ code: "BOOKING_EXECUTION_FAILED" });
    const row = await findByToken(db, token);
    expect(row?.status).toBe("consumed");
    expect(row?.finalStatus).toBe("EXECUTION_FAILED");

    // Re-redeem must surface the failure — NOT report the burned token as in_progress forever.
    await expect(redeem(deps(), token)).rejects.toMatchObject({ code: "BOOKING_EXECUTION_FAILED" });
  });

  test("Condition D: create ok but confirm never lands → held_unconfirmed, partial state recorded", async () => {
    const { token } = await propose(deps(), proposal());
    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ error: new Error("socket hang up") });
    interceptGet("HELD");
    interceptConfirm({ error: new Error("socket hang up") });
    interceptGet("HELD");

    const result = await redeem(deps(), token);
    expect(result).toMatchObject({ status: "held_unconfirmed", booking_id: BID, final_status: "HELD" });
    const row = await findByToken(db, token);
    expect(row?.bookingId).toBe(BID);
    expect(row?.finalStatus).toBe("HELD");
  });
});

describe("gate HTTP routes (real Postgres)", () => {
  test("GET card, then POST redeem executes and confirms", async () => {
    const { token } = await propose(deps(), proposal(), { conversationId: "conv-http" });
    const app = buildApp(deps());

    const cardRes = await app.inject({ method: "GET", url: `/api/v1/confirmations/${token}` });
    expect(cardRes.statusCode).toBe(200);
    expect(cardRes.json()).toMatchObject({ status: "pending", quote_id: QUOTE });

    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ status: 200, body: { id: BID, status: "CONFIRMED" } });

    const redeemRes = await app.inject({ method: "POST", url: `/api/v1/confirmations/${token}` });
    expect(redeemRes.statusCode).toBe(200);
    expect(redeemRes.json()).toMatchObject({ status: "confirmed", booking_id: BID });
    await app.close();
  });

  test("GET unknown token → 404 error envelope; malformed token → 400", async () => {
    const app = buildApp(deps());
    // Valid SHAPE (43 base64url chars) but no such row → 404, not a validation 400.
    const absent = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const notFound = await app.inject({ method: "GET", url: `/api/v1/confirmations/${absent}` });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({ code: "CONFIRMATION_NOT_FOUND", details: [] });

    const malformed = await app.inject({ method: "POST", url: "/api/v1/confirmations/!!" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    await app.close();
  });
});
