import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { GateDeps } from "../src/gate/gateService.js";

let app: FastifyInstance;

// /health touches neither the DB nor booking — stub deps are fine (routes register but aren't hit).
const stubDeps = { db: undefined, booking: undefined } as unknown as GateDeps;

beforeAll(async () => {
  app = buildApp(stubDeps);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test("GET /health returns ok", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok", service: "agent" });
});
