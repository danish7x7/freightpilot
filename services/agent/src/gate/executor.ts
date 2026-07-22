import type { BookingClient } from "../api/booking.js";
import { AGENT_ACTOR } from "../tools/types.js";
import { BookingExecutionError, QuoteUnavailableError } from "../domain/errors.js";

/**
 * THE proposal executor — the ONLY code in agent-service that issues the two REAL booking
 * calls (POST /bookings, then POST /bookings/{id}/confirm). This module is imported ONLY by
 * gateService (which is reachable only from the redeem route). The tool loop and tools MUST
 * NOT import it (Condition C — the hard boundary; enforced by test/gate/boundary.test.ts).
 *
 * Idempotency asymmetry (Condition D, verified against booking-service):
 *   - create is idempotent on Idempotency-Key = token (first-write-wins) → safe to replay.
 *   - confirm is NOT idempotent (HELD→CONFIRMED legal; CONFIRMED→CONFIRMED = 409) → recovery
 *     is reconcile-by-READ, never a blind re-POST that treats 409 as failure.
 */

const MAX_CONFIRM_ATTEMPTS = 2;

export interface ExecutionInput {
  quoteId: string;
  shipperRef: string;
  /** = the confirmation token (§6.3.2 / ADR-0005). */
  idempotencyKey: string;
  /** Provenance stamped into booking_events on BOTH calls (Condition E). */
  metadata: Record<string, unknown>;
}

export type ExecutionResult =
  | { outcome: "confirmed"; bookingId: string; finalStatus: "CONFIRMED"; replayed: boolean }
  | { outcome: "held_unconfirmed"; bookingId: string; finalStatus: string; detail: string };

export async function executeApprovedProposal(
  client: BookingClient,
  input: ExecutionInput,
): Promise<ExecutionResult> {
  // Step 1 — create. Idempotent on Idempotency-Key = token; a same-key replay returns the
  // original booking as 200 (vs 201 first-write).
  const create = await client.POST("/api/v1/bookings", {
    params: { header: { "Idempotency-Key": input.idempotencyKey } },
    body: {
      quote_id: input.quoteId,
      shipper_ref: input.shipperRef,
      actor: AGENT_ACTOR,
      metadata: input.metadata,
    },
  });

  if (create.error || !create.data) {
    // 409 → the quote is no longer HELD (consumed by another booking, or expired in the
    // up-to-10-min window since propose). Surface cleanly so the user re-quotes (Condition D).
    if (create.response.status === 409) {
      throw new QuoteUnavailableError(
        "Quote is no longer available to book — please re-quote",
        envelopeDetails(create.error),
      );
    }
    throw new BookingExecutionError(
      `booking create failed (HTTP ${create.response.status})`,
      envelopeDetails(create.error),
    );
  }

  const bookingId = create.data.id;
  const replayed = create.response.status === 200;

  // Step 2 — confirm, with reconcile-by-read.
  const confirm = await confirmWithReconcile(client, bookingId, input.metadata);
  if (confirm.confirmed) {
    return { outcome: "confirmed", bookingId, finalStatus: "CONFIRMED", replayed };
  }
  return { outcome: "held_unconfirmed", bookingId, finalStatus: confirm.status, detail: confirm.detail };
}

/**
 * Confirm with reconcile-by-read. After ANY confirm outcome (200, 409, or a transport
 * failure) that isn't a clean 200, READ the booking's actual status and decide:
 *   - CONFIRMED → success (the transition happened; only the ack was lost, or a concurrent
 *     redeem won the confirm). NEVER treat a resulting 409 as failure.
 *   - HELD → not yet confirmed; retry confirm (bounded).
 *   - anything else (CANCELLED/EXPIRED) → unrecoverable via confirm.
 */
async function confirmWithReconcile(
  client: BookingClient,
  bookingId: string,
  metadata: Record<string, unknown>,
): Promise<{ confirmed: boolean; status: string; detail: string }> {
  let lastDetail = "";

  for (let attempt = 1; attempt <= MAX_CONFIRM_ATTEMPTS; attempt++) {
    try {
      const res = await client.POST("/api/v1/bookings/{id}/confirm", {
        params: { path: { id: bookingId } },
        body: { actor: AGENT_ACTOR, metadata },
      });
      if (!res.error && res.data) {
        return { confirmed: true, status: "CONFIRMED", detail: "" };
      }
      lastDetail = `confirm HTTP ${res.response.status}`;
    } catch (err) {
      // Transport failure (timeout/network) — the transition may or may not have landed.
      lastDetail = `confirm transport error: ${String(err)}`;
    }

    // Reconcile against actual booking state.
    const current = await readBookingStatus(client, bookingId);
    if (current === "CONFIRMED") {
      return { confirmed: true, status: "CONFIRMED", detail: "" };
    }
    if (current !== "HELD") {
      // CANCELLED / EXPIRED / unreadable → cannot confirm.
      return { confirmed: false, status: current ?? "UNKNOWN", detail: `booking not confirmable (status ${current ?? "unknown"})` };
    }
    // Still HELD → safe to retry confirm (HELD→CONFIRMED).
  }

  // Attempts exhausted — one last read.
  const final = await readBookingStatus(client, bookingId);
  if (final === "CONFIRMED") return { confirmed: true, status: "CONFIRMED", detail: "" };
  return { confirmed: false, status: final ?? "HELD", detail: lastDetail || "confirm did not complete" };
}

async function readBookingStatus(client: BookingClient, bookingId: string): Promise<string | undefined> {
  try {
    const res = await client.GET("/api/v1/bookings/{id}", { params: { path: { id: bookingId } } });
    return res.data?.booking.status;
  } catch {
    return undefined;
  }
}

function envelopeDetails(error: unknown): string[] {
  if (error && typeof error === "object" && "message" in error) {
    return [String((error as { message: unknown }).message)];
  }
  return [];
}
