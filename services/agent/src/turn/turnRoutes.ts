import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runTurn, type TurnDeps } from "./turnService.js";

// POST /api/v1/turns — the L5 chat surface (§6.2). One turn of the agent loop; may mint a
// confirmation token (the `proposal` arm). Registered ONLY when the LLM chain is configured
// (server.ts); the confirmation gate does not depend on it.
const bodySchema = z.object({
  // Opaque continuation id (server mints one if absent). Bounded to keep it log/DB-safe.
  conversation_id: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(4000),
});

export function registerTurnRoute(app: FastifyInstance, deps: TurnDeps): void {
  app.post("/api/v1/turns", async (request, reply) => {
    const body = bodySchema.parse(request.body);
    const result = await runTurn(deps, {
      conversationId: body.conversation_id,
      message: body.message,
    });
    // A `proposal` result carries the secret token in the body ONLY — the access-log req
    // serializer (app.ts) masks confirmation URLs, and we never log the response body.
    return reply.code(200).send(result);
  });
}
