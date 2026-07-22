import { randomBytes } from "node:crypto";

/**
 * Mint a confirmation token (Condition F). In the absence of auth (a stated Non-Goal),
 * possession of this token IS the authorization to execute a booking — so it MUST be
 * cryptographically random and high-entropy. 32 bytes = 256 bits, base64url-encoded (~43
 * url-safe chars, no padding). It also doubles as the create Idempotency-Key (§6.3.2).
 */
export const TOKEN_BYTES = 32;

export function mintToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}
