import Fastify, { type FastifyInstance } from "fastify";

/**
 * Builds the Fastify app. Split from server.ts so tests can `inject` without
 * binding a port. At L0 the only route is a shallow /health liveness check that
 * does not touch the database (schema + state machine arrive in L1/L2).
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok", service: "booking" }));

  return app;
}
