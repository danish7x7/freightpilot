import { describe, expect, test, vi } from "vitest";
import { GeminiProvider } from "../../src/llm/geminiProvider.js";
import { OpenAiCompatProvider } from "../../src/llm/openAiCompatProvider.js";
import { LlmRouter, type RouterEntry } from "../../src/llm/router.js";
import { LlmChainExhaustedError, LlmError } from "../../src/llm/errors.js";
import { TokenBucket } from "../../src/llm/tokenBucket.js";
import { loadFixture } from "../fixtures/load.js";
import { TEXT_REQUEST } from "../fixtures/throwawayTool.js";
import { useMockHttp } from "./mockHttp.js";

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_PATH = "/v1beta/models/gemini-2.5-flash:generateContent";
const GROQ_ORIGIN = "https://api.groq.com";
const GROQ_PATH = "/openai/v1/chat/completions";

const http = useMockHttp();

// A generous bucket so pacing never blocks these fallback-logic tests.
const fastBucket = () => new TokenBucket({ rpm: 10_000 });

function chain(
  logger?: { warn: (d: Record<string, unknown>) => void },
  opts: { geminiTimeoutMs?: number } = {},
): LlmRouter {
  const entries: RouterEntry[] = [
    {
      provider: new GeminiProvider({
        name: "gemini",
        model: "gemini-2.5-flash",
        apiKey: "k",
        baseUrl: GEMINI_ORIGIN,
        timeoutMs: opts.geminiTimeoutMs ?? 8000,
      }),
      bucket: fastBucket(),
    },
    {
      provider: new OpenAiCompatProvider({
        name: "groq",
        model: "llama-3.3-70b-versatile",
        apiKey: "k",
        baseUrl: "https://api.groq.com/openai/v1",
        timeoutMs: 8000,
      }),
      bucket: fastBucket(),
    },
  ];
  return new LlmRouter(entries, logger);
}

describe("LlmRouter fallback allowlist", () => {
  test("429 on provider[0] advances to provider[1], which serves", async () => {
    http.intercept(GEMINI_ORIGIN, GEMINI_PATH, loadFixture("gemini/rate-limit-429.json"));
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/text.json"));
    const logger = { warn: vi.fn() };

    const res = await chain(logger).chat(TEXT_REQUEST);

    expect(res.provider).toBe("groq");
    expect(res.text).toBe("The quick brown fox.");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallback_used: true, provider: "gemini", kind: "rate_limit" }),
    );
  });

  test("a 400 on provider[0] does NOT advance the chain — it surfaces as a bug", async () => {
    http.intercept(GEMINI_ORIGIN, GEMINI_PATH, {
      status: 400,
      body: { error: { message: "malformed request" } },
    });
    // provider[1] is queued but must stay UNconsumed.
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/text.json"));
    const logger = { warn: vi.fn() };

    await expect(chain(logger).chat(TEXT_REQUEST)).rejects.toMatchObject({
      name: "LlmError",
      kind: "client",
      status: 400,
    });

    const pending = http.agent.pendingInterceptors();
    expect(pending).toHaveLength(1);
    expect(String(pending[0].path)).toBe(GROQ_PATH);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a 5xx on provider[0] advances to provider[1]", async () => {
    http.intercept(GEMINI_ORIGIN, GEMINI_PATH, {
      status: 503,
      body: { error: { message: "overloaded" } },
    });
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/text.json"));
    const logger = { warn: vi.fn() };

    const res = await chain(logger).chat(TEXT_REQUEST);

    expect(res.provider).toBe("groq");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallback_used: true, provider: "gemini", kind: "server" }),
    );
  });

  test("a malformed 200 (no candidate content) does NOT advance the chain", async () => {
    // The design's central claim: a garbled 200 must surface as a bug, never be masked.
    http.intercept(GEMINI_ORIGIN, GEMINI_PATH, { status: 200, body: { candidates: [] } });
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/text.json"));
    const logger = { warn: vi.fn() };

    await expect(chain(logger).chat(TEXT_REQUEST)).rejects.toMatchObject({
      name: "LlmError",
      kind: "malformed",
    });

    // provider[1] must be untouched.
    expect(http.agent.pendingInterceptors()).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a timed-out provider[0] falls through to provider[1]", async () => {
    // MockAgent delays the response past the 20ms provider deadline → AbortController fires.
    http.agent
      .get(GEMINI_ORIGIN)
      .intercept({ path: GEMINI_PATH, method: "POST" })
      .reply(200, loadFixture("gemini/text.json").body as object)
      .delay(200);
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/text.json"));
    const logger = { warn: vi.fn() };

    const res = await chain(logger, { geminiTimeoutMs: 20 }).chat(TEXT_REQUEST);

    expect(res.provider).toBe("groq");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallback_used: true, provider: "gemini", kind: "timeout" }),
    );
  });

  test("a network error on provider[0] falls through to provider[1]", async () => {
    http.agent
      .get(GEMINI_ORIGIN)
      .intercept({ path: GEMINI_PATH, method: "POST" })
      .replyWithError(new Error("socket hang up"));
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/text.json"));
    const logger = { warn: vi.fn() };

    const res = await chain(logger).chat(TEXT_REQUEST);

    expect(res.provider).toBe("groq");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallback_used: true, provider: "gemini", kind: "network" }),
    );
  });

  test("all providers 429 → LlmChainExhaustedError", async () => {
    http.intercept(GEMINI_ORIGIN, GEMINI_PATH, loadFixture("gemini/rate-limit-429.json"));
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/rate-limit-429.json"));

    const err = await chain().chat(TEXT_REQUEST).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LlmChainExhaustedError);
    expect((err as LlmChainExhaustedError).attempts.map((a) => a.provider)).toEqual([
      "gemini",
      "groq",
    ]);
    expect((err as LlmChainExhaustedError).attempts.every((a) => a.error instanceof LlmError)).toBe(
      true,
    );
  });
});
