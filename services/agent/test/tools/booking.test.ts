import { describe, expect, test } from "vitest";
import { createBookingClient } from "../../src/api/booking.js";
import {
  createBookingTool,
  getBookingTool,
  holdQuoteTool,
} from "../../src/tools/booking.js";
import type { ToolClients } from "../../src/tools/types.js";
import { useMockHttp } from "../llm/mockHttp.js";

const BOOKING_ORIGIN = "http://booking-service:8081";
const http = useMockHttp();

function clients(): ToolClients {
  return {
    rates: null as never,
    booking: createBookingClient(BOOKING_ORIGIN),
  };
}

const QUOTE_ID = "22222222-2222-2222-2222-222222222222";
const BOOKING_ID = "33333333-3333-3333-3333-333333333333";

describe("hold_quote (courier over POST /api/v1/quotes/{id}/hold)", () => {
  test("forwards a 200 held quote verbatim, sending actor=agent", async () => {
    const body = { id: QUOTE_ID, status: "HELD" };
    http.agent
      .get(BOOKING_ORIGIN)
      .intercept({
        path: `/api/v1/quotes/${QUOTE_ID}/hold`,
        method: "POST",
        body: (raw) => JSON.parse(raw).actor === "agent", // agent identity is fixed, never LLM-supplied
      })
      .reply(200, body);

    const exec = await holdQuoteTool.execute({ quote_id: QUOTE_ID }, clients());

    expect(exec).toEqual({ kind: "service_result", result: { ok: true, status: 200, data: body } });
  });

  test("forwards a 409 ILLEGAL_TRANSITION verbatim — the state machine's veto is authoritative", async () => {
    const envelope = { code: "ILLEGAL_TRANSITION", message: "quote not ACTIVE", details: [] };
    http.agent
      .get(BOOKING_ORIGIN)
      .intercept({ path: `/api/v1/quotes/${QUOTE_ID}/hold`, method: "POST" })
      .reply(409, envelope);

    const exec = await holdQuoteTool.execute({ quote_id: QUOTE_ID }, clients());

    expect(exec).toEqual({ kind: "service_result", result: { ok: false, status: 409, error: envelope } });
  });
});

describe("get_booking (courier over GET /api/v1/bookings/{id})", () => {
  test("forwards a 200 booking detail verbatim", async () => {
    const body = { booking: { id: BOOKING_ID, status: "HELD" }, events: [] };
    http.agent
      .get(BOOKING_ORIGIN)
      .intercept({ path: `/api/v1/bookings/${BOOKING_ID}`, method: "GET" })
      .reply(200, body);

    const exec = await getBookingTool.execute({ booking_id: BOOKING_ID }, clients());

    expect(exec).toEqual({ kind: "service_result", result: { ok: true, status: 200, data: body } });
  });
});

describe("create_booking is PROPOSE-ONLY (the load-bearing L2 invariant)", () => {
  test("returns an inert proposal modeling ADR-0005's two calls, actor=agent, no token", async () => {
    const exec = await createBookingTool.execute(
      { quote_id: QUOTE_ID, shipper_ref: "PO-4471" },
      clients(),
    );

    expect(exec).toEqual({
      kind: "proposal",
      proposal: {
        kind: "create_booking_proposal",
        create: {
          method: "POST",
          path: "/api/v1/bookings",
          idempotencyKey: null, // minted in L3, never here
          body: { quote_id: QUOTE_ID, shipper_ref: "PO-4471", actor: "agent" },
        },
        confirm: {
          method: "POST",
          pathTemplate: "/api/v1/bookings/{id}/confirm",
          bookingId: null, // resolved from step-1's response in L3
          body: { actor: "agent" },
        },
      },
    });
  });

  test("the proposal is pure serializable data — no method, closure, or client reference", async () => {
    const exec = await createBookingTool.execute(
      { quote_id: QUOTE_ID, shipper_ref: "PO-4471" },
      clients(),
    );
    if (exec.kind !== "proposal") throw new Error("expected a proposal");

    // A JSON round-trip that deep-equals the original proves the object holds no functions or
    // non-serializable references — structurally it CANNOT execute anything.
    expect(JSON.parse(JSON.stringify(exec.proposal))).toEqual(exec.proposal);
  });

  test("GUARD: proposing issues ZERO HTTP calls to booking-service (no POST /bookings*)", async () => {
    // Register would-succeed interceptors for BOTH booking-execution endpoints. If create_booking
    // ever executed as a side effect of being proposed, one of these would be consumed. With
    // disableNetConnect any stray call also throws. Both staying PENDING proves zero execution —
    // this is the first real test of "LLM proposes, never executes" and the seam L3 fills.
    http.agent
      .get(BOOKING_ORIGIN)
      .intercept({ path: "/api/v1/bookings", method: "POST" })
      .reply(201, { id: BOOKING_ID, status: "HELD" });
    http.agent
      .get(BOOKING_ORIGIN)
      .intercept({ path: `/api/v1/bookings/${BOOKING_ID}/confirm`, method: "POST" })
      .reply(200, { id: BOOKING_ID, status: "CONFIRMED" });

    await createBookingTool.execute({ quote_id: QUOTE_ID, shipper_ref: "PO-4471" }, clients());

    const pendingPaths = http.agent.pendingInterceptors().map((i) => String(i.path));
    expect(pendingPaths).toContain("/api/v1/bookings");
    expect(pendingPaths).toContain(`/api/v1/bookings/${BOOKING_ID}/confirm`);
    expect(pendingPaths).toHaveLength(2); // nothing consumed
  });
});
