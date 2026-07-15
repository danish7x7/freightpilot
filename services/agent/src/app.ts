import Fastify, { type FastifyInstance } from "fastify";

/**
 * Builds the Fastify app. Split from server.ts so tests can `inject` without
 * binding a port. At L0 the only route is a shallow /health liveness check.
 *
 * Reminder (hard rule): agent-service reaches rates/booking ONLY via their public
 * REST APIs (RATES_SERVICE_URL / BOOKING_SERVICE_URL) and never their databases.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok", service: "agent" }));

  return app;
}
