import { and, eq, gt } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { confirmations } from "../db/schema.js";
import { mintToken } from "./token.js";

export type Confirmation = InferSelectModel<typeof confirmations>;

/** Confirmation TTL — 10 minutes (§6.3.2). */
export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

export interface MintInput {
  quoteId: string;
  shipperRef: string;
  conversationId?: string;
  /** Override for tests (e.g. an already-expired TTL). Defaults to CONFIRMATION_TTL_MS. */
  ttlMs?: number;
}

/** Mint a pending confirmation with a fresh crypto-random token. Stores the server-authoritative proposal payload. */
export async function mintConfirmation(db: Db, input: MintInput): Promise<Confirmation> {
  const now = Date.now();
  const [row] = await db
    .insert(confirmations)
    .values({
      token: mintToken(),
      quoteId: input.quoteId,
      shipperRef: input.shipperRef,
      conversationId: input.conversationId ?? null,
      expiresAt: new Date(now + (input.ttlMs ?? CONFIRMATION_TTL_MS)),
    })
    .returning();
  return row;
}

export async function findByToken(db: Db, token: string): Promise<Confirmation | undefined> {
  return db.query.confirmations.findFirst({ where: eq(confirmations.token, token) });
}

/**
 * Atomic single-use claim (Condition B). Flips exactly ONE `pending`, non-expired row to
 * `consumed` and returns it. Under a concurrent double-redeem the row lock serializes the two
 * UPDATEs: only one matches `status='pending'` and wins; the loser gets `undefined` and must
 * reconcile by reading the stored result. MANDATORY, not belt-and-suspenders — confirm is not
 * idempotent, so a second execution would 409 on an already-CONFIRMED booking.
 */
export async function claimForRedemption(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<Confirmation | undefined> {
  const [row] = await db
    .update(confirmations)
    .set({ status: "consumed", consumedAt: now })
    .where(
      and(
        eq(confirmations.token, token),
        eq(confirmations.status, "pending"),
        gt(confirmations.expiresAt, now),
      ),
    )
    .returning();
  return row;
}

/** Record the execution outcome on a consumed row so a re-redeem/GET returns it without re-hitting booking-service. */
export async function recordExecution(
  db: Db,
  id: string,
  result: { bookingId: string | null; finalStatus: string; executionMeta?: unknown },
): Promise<void> {
  await db
    .update(confirmations)
    .set({
      bookingId: result.bookingId,
      finalStatus: result.finalStatus,
      executionMeta: (result.executionMeta ?? null) as Record<string, unknown> | null,
    })
    .where(eq(confirmations.id, id));
}

/** Best-effort: mark a pending-but-past-TTL row expired. */
export async function markExpired(db: Db, id: string): Promise<void> {
  await db
    .update(confirmations)
    .set({ status: "expired" })
    .where(and(eq(confirmations.id, id), eq(confirmations.status, "pending")));
}
