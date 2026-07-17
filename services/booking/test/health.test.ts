import { afterAll, beforeAll, expect, test } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { Db } from "../src/db/client.js";

let app: FastifyInstance;

beforeAll(async () => {
  // /health is DB-free, so a stub db is fine — its handlers are never invoked here.
  app = buildApp({} as unknown as Db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test("GET /health returns ok", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: "ok", service: "booking" });
});
