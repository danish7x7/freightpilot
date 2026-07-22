import { describe, expect, test } from "vitest";
import { createBookingClient } from "../../src/api/booking.js";
import { executeApprovedProposal } from "../../src/gate/executor.js";
import { BookingExecutionError, QuoteUnavailableError } from "../../src/domain/errors.js";
import { useMockHttp } from "../llm/mockHttp.js";

const BOOKING = "http://booking-service:8081";
const BID = "33333333-3333-3333-3333-333333333333";
const TOKEN = "test-token-abc";
const http = useMockHttp();

function client() {
  return createBookingClient(BOOKING);
}
const input = () => ({
  quoteId: "22222222-2222-2222-2222-222222222222",
  shipperRef: "PO-1",
  idempotencyKey: TOKEN,
  metadata: { source: "agent_gate", confirmation_id: "c1" },
});

// --- interceptor helpers -----------------------------------------------------------------
// Both booking bodies MUST carry actor=agent + gate provenance (Condition E); a body that
// doesn't match won't be intercepted → disableNetConnect throws → the test fails loudly.
function interceptCreate(status: number, body: unknown) {
  http.agent
    .get(BOOKING)
    .intercept({
      path: "/api/v1/bookings",
      method: "POST",
      headers: { "Idempotency-Key": TOKEN }, // token doubles as the Idempotency-Key
      body: (raw) => {
        const b = JSON.parse(raw);
        return b.actor === "agent" && b.metadata?.source === "agent_gate";
      },
    })
    .reply(status, body as object);
}
function interceptConfirm(reply: { status: number; body: unknown } | { error: Error }) {
  const i = http.agent
    .get(BOOKING)
    .intercept({
      path: `/api/v1/bookings/${BID}/confirm`,
      method: "POST",
      // Condition E: the confirm body — like create — must carry actor=agent AND gate provenance.
      body: (raw) => {
        const b = JSON.parse(raw);
        return b.actor === "agent" && b.metadata?.source === "agent_gate";
      },
    });
  if ("error" in reply) i.replyWithError(reply.error);
  else i.reply(reply.status, reply.body as object);
}
function interceptGet(status: string) {
  http.agent
    .get(BOOKING)
    .intercept({ path: `/api/v1/bookings/${BID}`, method: "GET" })
    .reply(200, { booking: { id: BID, status }, events: [] });
}

describe("executeApprovedProposal — two-call create+confirm (Condition D)", () => {
  test("happy path: create 201 (HELD) then confirm 200 → confirmed", async () => {
    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ status: 200, body: { id: BID, status: "CONFIRMED" } });

    const res = await executeApprovedProposal(client(), input());
    expect(res).toEqual({ outcome: "confirmed", bookingId: BID, finalStatus: "CONFIRMED", replayed: false });
    expect(http.agent.pendingInterceptors()).toHaveLength(0);
  });

  test("create replay (200) is surfaced as replayed:true", async () => {
    interceptCreate(200, { id: BID, status: "HELD" }); // idempotent replay of a prior create
    interceptConfirm({ status: 200, body: { id: BID, status: "CONFIRMED" } });

    const res = await executeApprovedProposal(client(), input());
    expect(res).toMatchObject({ outcome: "confirmed", replayed: true });
  });

  test("create 409 (quote no longer HELD) → QuoteUnavailableError, no confirm attempted", async () => {
    interceptCreate(409, { code: "STATE_CONFLICT", message: "quote not HELD", details: [] });

    await expect(executeApprovedProposal(client(), input())).rejects.toBeInstanceOf(QuoteUnavailableError);
  });

  test("create 5xx (not a 409) → BookingExecutionError, no confirm attempted", async () => {
    interceptCreate(503, { code: "INTERNAL_ERROR", message: "overloaded", details: [] });

    await expect(executeApprovedProposal(client(), input())).rejects.toBeInstanceOf(BookingExecutionError);
  });

  test("confirm 409 but booking already CONFIRMED → reconcile-by-read treats it as success", async () => {
    // The confirm's ack maps to an illegal CONFIRMED→CONFIRMED; the read shows the transition
    // DID happen (e.g. a concurrent confirm won). Must NOT be treated as failure.
    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ status: 409, body: { code: "ILLEGAL_TRANSITION", message: "x", details: [] } });
    interceptGet("CONFIRMED");

    const res = await executeApprovedProposal(client(), input());
    expect(res).toMatchObject({ outcome: "confirmed", finalStatus: "CONFIRMED" });
  });

  test("confirm times out, then read shows CONFIRMED → success (ack was lost)", async () => {
    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ error: new Error("socket hang up") });
    interceptGet("CONFIRMED");

    const res = await executeApprovedProposal(client(), input());
    expect(res).toMatchObject({ outcome: "confirmed" });
  });

  test("confirm fails, booking still HELD → retry confirm, which succeeds", async () => {
    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ error: new Error("socket hang up") }); // attempt 1 transport error
    interceptGet("HELD"); // reconcile: still held → retry
    interceptConfirm({ status: 200, body: { id: BID, status: "CONFIRMED" } }); // attempt 2 succeeds

    const res = await executeApprovedProposal(client(), input());
    expect(res).toMatchObject({ outcome: "confirmed" });
    expect(http.agent.pendingInterceptors()).toHaveLength(0);
  });

  test("confirm never completes, booking stays HELD → held_unconfirmed (partial failure)", async () => {
    interceptCreate(201, { id: BID, status: "HELD" });
    interceptConfirm({ error: new Error("socket hang up") }); // attempt 1
    interceptGet("HELD");
    interceptConfirm({ error: new Error("socket hang up") }); // attempt 2
    interceptGet("HELD"); // final reconcile

    const res = await executeApprovedProposal(client(), input());
    expect(res).toMatchObject({ outcome: "held_unconfirmed", bookingId: BID, finalStatus: "HELD" });
  });
});
