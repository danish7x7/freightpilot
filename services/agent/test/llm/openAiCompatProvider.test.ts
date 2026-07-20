import { describe, expect, test } from "vitest";
import { OpenAiCompatProvider } from "../../src/llm/openAiCompatProvider.js";
import { loadFixture } from "../fixtures/load.js";
import { TEXT_REQUEST, TOOLCALL_REQUEST } from "../fixtures/throwawayTool.js";
import { useMockHttp } from "./mockHttp.js";

const GROQ_ORIGIN = "https://api.groq.com";
const GROQ_PATH = "/openai/v1/chat/completions";
const CEREBRAS_ORIGIN = "https://api.cerebras.ai";
const CEREBRAS_PATH = "/v1/chat/completions";

const http = useMockHttp();

function groq(): OpenAiCompatProvider {
  return new OpenAiCompatProvider({
    name: "groq",
    model: "llama-3.3-70b-versatile",
    apiKey: "test-key",
    baseUrl: "https://api.groq.com/openai/v1",
    timeoutMs: 8000,
  });
}

function cerebras(): OpenAiCompatProvider {
  return new OpenAiCompatProvider({
    name: "cerebras",
    model: "llama-3.3-70b",
    apiKey: "test-key",
    baseUrl: "https://api.cerebras.ai/v1",
    timeoutMs: 8000,
  });
}

describe("OpenAiCompatProvider (replay)", () => {
  test("Groq: normalizes a plain text completion + usage", async () => {
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/text.json"));

    const res = await groq().chat(TEXT_REQUEST);

    expect(res.text).toBe("The quick brown fox.");
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toEqual({ inputTokens: 11, outputTokens: 5 });
    expect(res.provider).toBe("groq");
  });

  test("Groq: parses tool_calls JSON-string arguments into the one internal shape", async () => {
    http.intercept(GROQ_ORIGIN, GROQ_PATH, loadFixture("groq/toolcall.json"));

    const res = await groq().chat(TOOLCALL_REQUEST);

    expect(res.text).toBeNull();
    expect(res.toolCalls).toEqual([
      { id: "call_groq_abc", name: "get_weather", arguments: { city: "Berlin" } },
    ]);
  });

  test("Cerebras: SAME class serves a different base URL (text)", async () => {
    http.intercept(CEREBRAS_ORIGIN, CEREBRAS_PATH, loadFixture("cerebras/text.json"));

    const res = await cerebras().chat(TEXT_REQUEST);

    expect(res.text).toBe("The quick brown fox.");
    expect(res.provider).toBe("cerebras");
    expect(res.model).toBe("llama-3.3-70b");
  });

  test("Cerebras: normalizes tool_calls (same class, different base URL)", async () => {
    http.intercept(CEREBRAS_ORIGIN, CEREBRAS_PATH, loadFixture("cerebras/toolcall.json"));

    const res = await cerebras().chat(TOOLCALL_REQUEST);

    expect(res.toolCalls).toEqual([
      { id: "call_cerebras_xyz", name: "get_weather", arguments: { city: "Berlin" } },
    ]);
  });

  test("tool_call with non-JSON arguments surfaces as malformed (not a fallback)", async () => {
    http.intercept(GROQ_ORIGIN, GROQ_PATH, {
      status: 200,
      body: {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "call_bad", type: "function", function: { name: "get_weather", arguments: "{not json" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    });

    await expect(groq().chat(TOOLCALL_REQUEST)).rejects.toMatchObject({
      name: "LlmError",
      kind: "malformed",
    });
  });
});
