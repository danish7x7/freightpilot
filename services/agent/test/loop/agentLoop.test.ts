import { describe, expect, test, vi } from "vitest";
import { buildLlmRouter } from "../../src/llm/index.js";
import type { LlmMessage } from "../../src/llm/index.js";
import { createRatesClient } from "../../src/api/rates.js";
import { createBookingClient } from "../../src/api/booking.js";
import { searchRatesTool } from "../../src/tools/rates.js";
import { createBookingTool } from "../../src/tools/booking.js";
import type { ToolClients } from "../../src/tools/types.js";
import { runAgentTurn } from "../../src/loop/agentLoop.js";
import { useMockHttp } from "../llm/mockHttp.js";

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_PATH = "/v1beta/models/gemini-2.5-flash:generateContent";
const RATES_ORIGIN = "http://rates-service:8080";

const http = useMockHttp();

// Real router wiring (buildLlmRouter) driven by replayed Gemini fixtures. GEMINI_RPM is left at
// its default (10) — the bucket starts full, so ≤2 calls never pace-block.
const ENV = { LLM_CHAIN: "gemini:gemini-2.5-flash", GEMINI_API_KEY: "k" } as NodeJS.ProcessEnv;

function clients(): ToolClients {
  return { rates: createRatesClient(RATES_ORIGIN), booking: createBookingClient("http://booking-service:8081") };
}

// --- hand-authored Gemini wire bodies (same shape the recorder captures) -----------------
function geminiToolCall(name: string, args: Record<string, unknown>) {
  return {
    candidates: [{ content: { parts: [{ functionCall: { name, args } }], role: "model" }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 12 },
  };
}
function geminiText(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 },
  };
}
function interceptGemini(body: unknown) {
  http.agent.get(GEMINI_ORIGIN).intercept({ path: GEMINI_PATH, method: "POST" }).reply(200, body as object);
}

const USER: LlmMessage[] = [{ role: "user", content: "Ocean rates Shanghai to Oakland on 2026-08-01" }];
const VALID = { origin: "CNSHA", dest: "USOAK", mode: "OCEAN", ship_date: "2026-08-01" };

describe("runAgentTurn — extract → validate → retry → form-fallback", () => {
  test("valid extraction executes the tool and forwards the service result", async () => {
    interceptGemini(geminiToolCall("search_rates", VALID));
    const rateCards = { rate_cards: [{ id: "rc-1" }] };
    http.agent
      .get(RATES_ORIGIN)
      .intercept({ path: "/api/v1/rates/search", method: "GET", query: VALID })
      .reply(200, rateCards);

    const result = await runAgentTurn({ router: buildLlmRouter(ENV), tools: [searchRatesTool], clients: clients(), messages: [...USER] });

    expect(result).toEqual({
      kind: "tool",
      tool: "search_rates",
      execution: { kind: "service_result", result: { ok: true, status: 200, data: rateCards } },
    });
  });

  test("invalid args → ONE retry with the errors fed back → valid → executes", async () => {
    // Attempt 1: origin too short (fails Zod). Attempt 2: corrected → valid.
    interceptGemini(geminiToolCall("search_rates", { ...VALID, origin: "CN" }));
    interceptGemini(geminiToolCall("search_rates", VALID));
    http.agent
      .get(RATES_ORIGIN)
      .intercept({ path: "/api/v1/rates/search", method: "GET", query: VALID })
      .reply(200, { rate_cards: [] });

    const logger = { info: vi.fn(), warn: vi.fn() };
    const result = await runAgentTurn({ router: buildLlmRouter(ENV), tools: [searchRatesTool], clients: clients(), messages: [...USER], logger });

    expect(result).toMatchObject({ kind: "tool", tool: "search_rates" });
    // The retry seam actually fired (one invalid extraction was logged).
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "extract_invalid", attempt: 1 }));
    // Both Gemini turns + the rates call were consumed.
    expect(http.agent.pendingInterceptors()).toHaveLength(0);
  });

  test("still invalid after the retry → form fallback (no tool executes)", async () => {
    interceptGemini(geminiToolCall("search_rates", { ...VALID, origin: "CN" }));
    interceptGemini(geminiToolCall("search_rates", { ...VALID, dest: "X" }));

    const result = await runAgentTurn({ router: buildLlmRouter(ENV), tools: [searchRatesTool], clients: clients(), messages: [...USER] });

    expect(result).toMatchObject({ kind: "form_fallback", reason: "validation_failed_after_retry" });
    expect((result as { validationErrors: string[] }).validationErrors.length).toBeGreaterThan(0);
  });

  test("a text-only response (no tool call) is returned as text, not a failure", async () => {
    interceptGemini(geminiText("Which port pair did you mean?"));

    const result = await runAgentTurn({ router: buildLlmRouter(ENV), tools: [searchRatesTool], clients: clients(), messages: [...USER] });

    expect(result).toEqual({ kind: "text", text: "Which port pair did you mean?" });
  });

  test("a hallucinated (unknown) tool name retries, then falls back to the form", async () => {
    // Neither turn names a registered tool → the unknown-tool branch feeds an error into the
    // one retry, then form-fallback. Only search_rates is registered here.
    interceptGemini(geminiToolCall("book_everything_now", { yolo: true }));
    interceptGemini(geminiToolCall("book_everything_now", { yolo: true }));

    const result = await runAgentTurn({ router: buildLlmRouter(ENV), tools: [searchRatesTool], clients: clients(), messages: [...USER] });

    expect(result).toMatchObject({ kind: "form_fallback", reason: "validation_failed_after_retry" });
    expect((result as { validationErrors: string[] }).validationErrors[0]).toMatch(/unknown tool/);
  });

  test("create_booking surfaces through the loop as an inert proposal, issuing zero service calls", async () => {
    // The model proposes a booking; the loop must return a `proposal` execution WITHOUT any
    // booking-service call. disableNetConnect makes any stray call throw — so a clean return
    // here is itself proof the proposal executed nothing.
    interceptGemini(
      geminiToolCall("create_booking", {
        quote_id: "22222222-2222-2222-2222-222222222222",
        shipper_ref: "PO-4471",
      }),
    );

    const result = await runAgentTurn({
      router: buildLlmRouter(ENV),
      tools: [createBookingTool],
      clients: clients(),
      messages: [{ role: "user", content: "Book quote 2222... as PO-4471" }],
    });

    expect(result).toMatchObject({ kind: "tool", tool: "create_booking" });
    const exec = (result as { execution: { kind: string } }).execution;
    expect(exec.kind).toBe("proposal");
    // Only the Gemini turn was consumed — no booking interceptor existed and none was needed.
    expect(http.agent.pendingInterceptors()).toHaveLength(0);
  });
});
