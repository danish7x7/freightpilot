import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Db } from "./db/client.js";
import { AppError } from "./domain/errors.js";
import { registerRoutes } from "./routes.js";

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Builds the Fastify app. Split from server.ts so tests can `inject` without binding a
 * port. `/health` is a shallow liveness check that deliberately does NOT touch the DB
 * (guardian: don't couple liveness to a transient post-boot DB blip). All state mutation
 * flows through the domain service (routes.ts → bookingService.ts).
 */
export function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: true });

  // Echo or mint X-Request-Id on every response (§5 correlation; mirrors rates' RequestIdFilter).
  app.addHook("onRequest", async (request, reply) => {
    const incoming = request.headers["x-request-id"];
    const id =
      typeof incoming === "string" && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    reply.header("X-Request-Id", id);
  });

  app.get("/health", async () => ({ status: "ok", service: "booking" }));

  registerRoutes(app, db);

  // Uniform error envelope {code, message, details[]} (§5). Typed domain errors carry status.
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ code: "NOT_FOUND", message: "Route not found", details: [] });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.httpStatus)
        .send({ code: error.code, message: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      const details = error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      return reply
        .code(400)
        .send({ code: "VALIDATION_ERROR", message: "Request validation failed", details });
    }
    // Framework 4xx (e.g. malformed JSON body) — don't leak internals.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ code: "BAD_REQUEST", message: "Malformed request", details: [] });
    }
    request.log.error(error);
    return reply.code(500).send({ code: "INTERNAL_ERROR", message: "Unexpected error", details: [] });
  });

  return app;
}
