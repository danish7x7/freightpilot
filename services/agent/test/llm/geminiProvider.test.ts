import { describe, expect, test } from "vitest";
import { GeminiProvider } from "../../src/llm/geminiProvider.js";
import { loadFixture } from "../fixtures/load.js";
import { TEXT_REQUEST, TOOLCALL_REQUEST } from "../fixtures/throwawayTool.js";
import { useMockHttp } from "./mockHttp.js";

const ORIGIN = "https://generativelanguage.googleapis.com";
const PATH = "/v1beta/models/gemini-2.5-flash:generateContent";

const http = useMockHttp();

function provider(): GeminiProvider {
  return new GeminiProvider({
    name: "gemini",
    model: "gemini-2.5-flash",
    apiKey: "test-key",
    baseUrl: ORIGIN,
    timeoutMs: 8000,
  });
}

describe("GeminiProvider (replay)", () => {
  test("normalizes a plain text completion + usage", async () => {
    http.intercept(ORIGIN, PATH, loadFixture("gemini/text.json"));

    const res = await provider().chat(TEXT_REQUEST);

    expect(res.text).toBe("The quick brown fox.");
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 5 });
    expect(res.provider).toBe("gemini");
    expect(res.model).toBe("gemini-2.5-flash");
  });

  test("normalizes a Gemini functionCall to the one internal tool-call shape", async () => {
    http.intercept(ORIGIN, PATH, loadFixture("gemini/toolcall.json"));

    const res = await provider().chat(TOOLCALL_REQUEST);

    expect(res.text).toBeNull();
    expect(res.toolCalls).toEqual([
      { id: "call_0", name: "get_weather", arguments: { city: "Berlin" } },
    ]);
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
  });

  test("a 200 with no candidate content surfaces as a malformed error (not a fallback)", async () => {
    http.intercept(ORIGIN, PATH, { status: 200, body: { candidates: [{}] } });

    await expect(provider().chat(TEXT_REQUEST)).rejects.toMatchObject({
      name: "LlmError",
      kind: "malformed",
    });
  });
});
