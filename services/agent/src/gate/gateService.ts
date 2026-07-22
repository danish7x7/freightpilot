import type { Db } from "../db/client.js";
import type { BookingClient } from "../api/booking.js";
import type { CreateBookingProposal } from "../tools/proposal.js";
import { BookingExecutionError, ConfirmationExpiredError, ConfirmationNotFoundError, QuoteUnavailableError } from "../domain/errors.js";
import {
  claimForRedemption,
  findByToken,
  markExpired,
  mintConfirmation,
  recordExecution,
  type Confirmation,
} from "./confirmationStore.js";
import { executeApprovedProposal } from "./executor.js";

/**
 * The confirmation gate (§6.3.2). Two responsibilities:
 *   - propose(): at PROPOSE/card time — mint the token, persist the row, return the card. Called
 *     by the future L5 turn-handler AFTER runAgentTurn returns an inert proposal; NOT by the loop.
 *   - redeem(): at user-click time — single-use claim then execute the two calls.
 *
 * This is the ONLY module wired to the executor. The tool loop cannot reach it (Condition C).
 */

export interface GateLogger {
  info(data: Record<string, unknown>): void;
  warn(data: Record<string, unknown>): void;
}
const noopLogger: GateLogger = { info: () => {}, warn: () => {} };

export interface GateDeps {
  db: Db;
  booking: BookingClient;
  logger?: GateLogger;
}

export interface ProposeContext {
  conversationId?: string;
}

/** Non-secret view of a confirmation (the token is NOT re-emitted — the caller already holds it). */
export interface CardState {
  confirmation_id: string;
  quote_id: string;
  shipper_ref: string;
  status: string;
  expires_at: string;
  booking_id: string | null;
  final_status: string | null;
}

export type RedeemResult =
  | { status: "confirmed"; confirmation_id: string; booking_id: string; final_status: "CONFIRMED"; replayed: boolean }
  | { status: "held_unconfirmed"; confirmation_id: string; booking_id: string; final_status: string; detail: string }
  /** Concurrent double-redeem: the loser observed a consumed row the winner hasn't finished executing. */
  | { status: "in_progress"; confirmation_id: string };

export function toCardState(row: Confirmation): CardState {
  return {
    confirmation_id: row.id,
    quote_id: row.quoteId,
    shipper_ref: row.shipperRef,
    status: row.status,
    expires_at: row.expiresAt.toISOString(),
    booking_id: row.bookingId,
    final_status: row.finalStatus,
  };
}

/**
 * Mint a confirmation for an approved-shape proposal and return the token + card. The token is
 * the secret the user will click; the card is the non-secret state. Payload is taken from the
 * proposal (server-authoritative) — the redeem call never resends it (Condition A).
 */
export async function propose(
  deps: GateDeps,
  proposal: CreateBookingProposal,
  ctx: ProposeContext = {},
): Promise<{ token: string; card: CardState }> {
  const row = await mintConfirmation(deps.db, {
    quoteId: proposal.create.body.quote_id,
    shipperRef: proposal.create.body.shipper_ref,
    conversationId: ctx.conversationId,
  });
  (deps.logger ?? noopLogger).info({
    event: "confirmation_minted",
    confirmation_id: row.id, // NON-secret id, never the token (Condition F)
    quote_id: row.quoteId,
  });
  return { token: row.token, card: toCardState(row) };
}

export async function getCard(deps: GateDeps, token: string): Promise<CardState> {
  const row = await findByToken(deps.db, token);
  if (!row) throw new ConfirmationNotFoundError("No confirmation for this token");
  return toCardState(row);
}

/**
 * Redeem a token: the ONE path from an approved proposal to a booking. Single-use claim first
 * (Condition B), then execute exactly once (Condition D). Only a WON claim executes.
 */
export async function redeem(deps: GateDeps, token: string): Promise<RedeemResult> {
  const logger = deps.logger ?? noopLogger;
  const now = new Date();

  const claimed = await claimForRedemption(deps.db, token, now);
  if (!claimed) {
    // Lost the claim (or never claimable): reconcile by reading.
    const existing = await findByToken(deps.db, token);
    if (!existing) throw new ConfirmationNotFoundError("No confirmation for this token");
    if (existing.status === "consumed") {
      logger.info({ event: "redeem_replay", confirmation_id: existing.id, gate_decision: "already_consumed" });
      return storedResult(existing);
    }
    // pending but the claim's `expires_at > now` guard excluded it → expired.
    if (existing.expiresAt.getTime() <= now.getTime()) {
      await markExpired(deps.db, existing.id);
      logger.warn({ event: "redeem_rejected", confirmation_id: existing.id, gate_decision: "expired" });
      throw new ConfirmationExpiredError("This confirmation has expired");
    }
    throw new ConfirmationNotFoundError("Confirmation is not redeemable");
  }

  // We won the claim → execute exactly once. Provenance (Condition E): the non-secret
  // confirmation_id, conversation, and approval time — NOT the raw token.
  const metadata = {
    conversation_id: claimed.conversationId,
    confirmation_id: claimed.id,
    approved_at: (claimed.consumedAt ?? now).toISOString(),
    source: "agent_gate",
  };

  const t0 = Date.now();
  try {
    const result = await executeApprovedProposal(deps.booking, {
      quoteId: claimed.quoteId,
      shipperRef: claimed.shipperRef,
      idempotencyKey: token,
      metadata,
    });
    await recordExecution(deps.db, claimed.id, {
      bookingId: result.bookingId,
      finalStatus: result.finalStatus,
      executionMeta: result.outcome === "held_unconfirmed" ? { detail: result.detail } : null,
    });
    logger.info({
      event: "confirmation_redeemed",
      confirmation_id: claimed.id,
      gate_decision: "approved",
      outcome: result.outcome,
      booking_id: result.bookingId,
      latencyMs: Date.now() - t0,
      ...(result.outcome === "confirmed" ? { replayed: result.replayed } : {}),
    });
    if (result.outcome === "confirmed") {
      return { status: "confirmed", confirmation_id: claimed.id, booking_id: result.bookingId, final_status: "CONFIRMED", replayed: result.replayed };
    }
    return { status: "held_unconfirmed", confirmation_id: claimed.id, booking_id: result.bookingId, final_status: result.finalStatus, detail: result.detail };
  } catch (err) {
    // The token is spent (consumed). Record the failure — for EVERY failure mode, not just
    // quote-unavailable — so a re-redeem/GET reflects the live outcome instead of being
    // misreported as `in_progress` forever (the winner did finish; it failed).
    const finalStatus = err instanceof QuoteUnavailableError ? "QUOTE_UNAVAILABLE" : "EXECUTION_FAILED";
    await recordExecution(deps.db, claimed.id, {
      bookingId: null,
      finalStatus,
      executionMeta: { error: err instanceof Error ? err.message : String(err) },
    });
    logger.warn({ event: "redeem_failed", confirmation_id: claimed.id, gate_decision: "approved", reason: finalStatus });
    throw err;
  }
}

/** Map a consumed row to a stable result (double-redeem loser or re-click). */
function storedResult(row: Confirmation): RedeemResult {
  if (row.finalStatus === "QUOTE_UNAVAILABLE") {
    throw new QuoteUnavailableError("Quote is no longer available to book — please re-quote");
  }
  if (row.finalStatus === "EXECUTION_FAILED") {
    throw new BookingExecutionError("This confirmation's booking execution failed — please retry from a new quote");
  }
  if (row.bookingId && row.finalStatus === "CONFIRMED") {
    return { status: "confirmed", confirmation_id: row.id, booking_id: row.bookingId, final_status: "CONFIRMED", replayed: true };
  }
  if (row.bookingId) {
    return { status: "held_unconfirmed", confirmation_id: row.id, booking_id: row.bookingId, final_status: row.finalStatus ?? "HELD", detail: "previously redeemed" };
  }
  // Consumed but no outcome recorded yet → the winner is still executing.
  return { status: "in_progress", confirmation_id: row.id };
}
