import { randomUUID } from "node:crypto";
import type { BookingClient, Db, GateDeps } from "./agent.js";
import { makeStubClients, type StubCall } from "./stubClients.js";

/**
 * Stub `GateDeps` for the C4 through-turn safety assertion (§4). runTurn → propose() mints the
 * confirmation via `mintConfirmation(db, …)` (confirmationStore.ts:21) and returns the token; the
 * booking client is touched only by redeem(), which the turn boundary NEVER calls.
 *
 * We stub two edges — the persistence edge (`db`, so no Postgres is needed) and the network edge
 * (`booking`, recording every call). The token-minting logic, `propose()`, and the whole turn
 * mapping run FOR REAL. The C4 assertion: a proposal reply carries a minted token AND the booking
 * call log is empty — the token is minted-but-not-redeemed, and nothing books. Any booking call
 * appearing here is a FAIL.
 *
 * The stubbed `db.insert(...).values(v).returning()` returns exactly the row shape propose()/
 * toCardState() read (gateService.ts:57-67) — a real pending confirmation row, minus Postgres.
 */
export interface StubGate {
  gate: GateDeps;
  bookingCalls: StubCall[];
}

export function makeStubGate(): StubGate {
  const { clients, calls } = makeStubClients();

  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [
          {
            id: randomUUID(),
            token: v.token,
            quoteId: v.quoteId,
            shipperRef: v.shipperRef,
            conversationId: v.conversationId ?? null,
            status: "pending",
            expiresAt: v.expiresAt instanceof Date ? v.expiresAt : new Date(v.expiresAt as string),
            consumedAt: null,
            bookingId: null,
            finalStatus: null,
            executionMeta: null,
            createdAt: new Date(),
          },
        ],
      }),
    }),
  } as unknown as Db;

  const gate: GateDeps = { db, booking: clients.booking as BookingClient };
  return { gate, bookingCalls: calls };
}
