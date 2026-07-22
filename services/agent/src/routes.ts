// Agent-service HTTP routes — the confirmation gate's PUBLIC surface (§6.3.2). Two endpoints,
// both keyed by the secret token in the path:
//   GET  /api/v1/confirmations/:token  → fetch the card / current state (the L5 UI renders it)
//   POST /api/v1/confirmations/:token  → REDEEM: the single user-click path that executes a booking
// The redeem handler is the ONLY caller of gateService.redeem → executor (Condition C). No
// propose route: proposing is server-internal (the turn-handler mints after a proposal, L5).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { GateDeps, RedeemResult } from "./gate/gateService.js";
import { getCard, redeem } from "./gate/gateService.js";

// base64url token: 32 bytes → exactly 43 url-safe chars (mintToken). Reject junk early.
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "malformed confirmation token");

export function registerRoutes(app: FastifyInstance, deps: GateDeps): void {
  app.get("/api/v1/confirmations/:token", async (request, reply) => {
    const token = tokenSchema.parse((request.params as { token: string }).token);
    const card = await getCard(deps, token);
    return reply.code(200).send(card);
  });

  app.post("/api/v1/confirmations/:token", async (request, reply) => {
    const token = tokenSchema.parse((request.params as { token: string }).token);
    const result = await redeem(deps, token);
    return reply.code(redeemHttpStatus(result)).send(result);
  });
}

/** confirmed/held → 200 (a real, actionable state); in_progress → 202 (winner still executing). */
function redeemHttpStatus(result: RedeemResult): number {
  return result.status === "in_progress" ? 202 : 200;
}
