import { randomUUID } from "node:crypto";
import type { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { GateDeps } from "./gate/gateService.js";
import { AppError } from "./domain/errors.js";
import { LlmChainExhaustedError } from "./llm/index.js";
import { registerRoutes } from "./routes.js";
import { registerTurnRoute } from "./turn/turnRoutes.js";
import type { TurnDeps } from "./turn/turnService.js";

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
 * App deps = the confirmation gate (always) + the OPTIONAL turn surface. The turn route needs the
 * LLM router/tools/clients; when `turn` is absent (LLM unconfigured, or a gate-only test) the
 * service still serves the gate — the redeem path must never depend on the LLM being configured.
 */
export interface AppDeps extends GateDeps {
  turn?: Pick<TurnDeps, "router" | "tools" | "clients" | "runLoop">;
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
export function buildApp(deps: AppDeps, opts: BuildAppOptions = {}): FastifyInstance {
  const { turn, ...gate } = deps;
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
  const gateDeps: GateDeps = { ...gate, logger: gate.logger ?? app.log };
  registerRoutes(app, gateDeps);

  // The L5 turn surface, only when its LLM deps are supplied (server.ts builds them iff the LLM
  // chain is configured). propose() runs through the SAME gateDeps, so a minted token and a
  // redeemed token share one confirmations store.
  if (turn) {
    registerTurnRoute(app, { gate: gateDeps, logger: gateDeps.logger, ...turn });
  }

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
    // The turn path's EXPECTED outage in a $0/free-tier architecture: every provider rate-limited.
    // That is an upstream-dependency failure, not an internal bug — a 502 (matching the contract's
    // documented POST /turns response), never a misleading 500. Non-retryable LlmError kinds
    // (malformed/client) are genuine bugs and fall through to 500 below.
    if (error instanceof LlmChainExhaustedError) {
      return reply
        .code(502)
        .send({ code: "LLM_UNAVAILABLE", message: "The agent's LLM providers are all unavailable — please retry shortly", details: [] });
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
