import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { buildApp } from "../../src/app.js";
import { LlmChainExhaustedError, LlmError } from "../../src/llm/index.js";
import type { AgentTurnResult } from "../../src/loop/agentLoop.js";

// HTTP-level tests for POST /api/v1/turns via Fastify inject. A stub runLoop drives each path;
// none of these touch Postgres (the text arm and the error paths never reach propose()), so no
// Testcontainers — the DB-backed proposal mint lives in confirmations.it.test.ts.
const discard = new Writable({ write: (_c, _e, cb) => cb() });

function app(runLoop: () => Promise<AgentTurnResult>) {
  return buildApp(
    {
      db: {} as never,
      booking: {} as never,
      turn: { router: {} as never, tools: [], clients: {} as never, runLoop },
    },
    { logStream: discard },
  );
}

describe("POST /api/v1/turns", () => {
  test("text arm → 200 with an echoed conversation_id", async () => {
    const a = app(async () => ({ kind: "text", text: "Which port?" }));
    const res = await a.inject({ method: "POST", url: "/api/v1/turns", payload: { message: "hi" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: "text", text: "Which port?" });
    expect(res.json().conversation_id).toMatch(/^[0-9a-f-]{36}$/);
    await a.close();
  });

  test("all providers exhausted → 502 LLM_UNAVAILABLE (matches the contract, not a 500)", async () => {
    const exhausted = new LlmChainExhaustedError([
      { provider: "gemini", error: new LlmError("rate_limit", "gemini", "429") },
      { provider: "groq", error: new LlmError("rate_limit", "groq", "429") },
    ]);
    const a = app(async () => {
      throw exhausted;
    });
    const res = await a.inject({ method: "POST", url: "/api/v1/turns", payload: { message: "book it" } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: "LLM_UNAVAILABLE", details: [] });
    await a.close();
  });

  test("missing message → 400 VALIDATION_ERROR", async () => {
    const a = app(async () => ({ kind: "text", text: "unused" }));
    const res = await a.inject({ method: "POST", url: "/api/v1/turns", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    await a.close();
  });

  test("over-long message → 400 VALIDATION_ERROR", async () => {
    const a = app(async () => ({ kind: "text", text: "unused" }));
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/turns",
      payload: { message: "x".repeat(4001) },
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });
});
