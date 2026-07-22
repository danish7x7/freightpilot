import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { GateDeps } from "./gate/gateService.js";
import { AppError } from "./domain/errors.js";
import { registerRoutes } from "./routes.js";

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The confirmation token is a SECRET credential that rides in the URL path
 * (/api/v1/confirmations/<token>). Possession == authorization (Condition F), so it must NEVER
 * land in the access log. Mask the token segment in the logged req.url.
 */
export function maskConfirmationToken(url: string): string {
  return url.replace(/(\/confirmations\/)[^/?#]+/, "$1***");
}

export interface BuildAppOptions {
  /** Test hook: capture pino output. Defaults to stdout. */
  logStream?: Writable;
}

/**
 * Builds the Fastify app. Split from server.ts so tests can `inject` without binding a port.
 * `/health` is a shallow liveness check that deliberately does NOT touch the DB (mirrors
 * booking). The confirmation gate routes (§6.3.2) are registered with the injected deps, and
 * app.log is wired as the gate's telemetry logger unless one is supplied.
 *
 * Reminder (hard rule): agent-service reaches rates/booking ONLY via their public REST APIs
 * and never their databases; it owns ONLY the confirmations DB.
 */
export function buildApp(deps: GateDeps, opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      // Redact the secret token from the access log (Condition F).
      serializers: {
        req(request: { method: string; url: string; headers: Record<string, unknown> }) {
          return { method: request.method, url: maskConfirmationToken(request.url) };
        },
      },
      ...(opts.logStream ? { stream: opts.logStream } : {}),
    },
  });

  // Echo or mint X-Request-Id on every response (§5 correlation; mirrors booking/rates).
  app.addHook("onRequest", async (request, reply) => {
    const incoming = request.headers["x-request-id"];
    const id =
      typeof incoming === "string" && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    reply.header("X-Request-Id", id);
  });

  app.get("/health", async () => ({ status: "ok", service: "agent" }));

  // Wire app.log (a pino child) as the gate's telemetry sink unless the caller supplied one, so
  // gate decisions/redemptions are actually logged (L4 will persist; L3 logs only).
  const gateDeps: GateDeps = { ...deps, logger: deps.logger ?? app.log };
  registerRoutes(app, gateDeps);

  // Uniform error envelope {code, message, details[]} (§5). Typed domain errors carry status.
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ code: "NOT_FOUND", message: "Route not found", details: [] });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.httpStatus).send({ code: error.code, message: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      const details = error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Request validation failed", details });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ code: "BAD_REQUEST", message: "Malformed request", details: [] });
    }
    request.log.error(error);
    return reply.code(500).send({ code: "INTERNAL_ERROR", message: "Unexpected error", details: [] });
  });

  return app;
}
