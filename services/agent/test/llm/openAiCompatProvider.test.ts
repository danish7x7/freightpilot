import { describe, expect, test } from "vitest";
import { OpenAiCompatProvider } from "../../src/llm/openAiCompatProvider.js";
import { loadFixture, type WireFixture } from "../fixtures/load.js";
import { TEXT_REQUEST, TOOLCALL_REQUEST } from "../fixtures/throwawayTool.js";
import { useMockHttp } from "./mockHttp.js";

const GROQ_ORIGIN = "https://api.groq.com";
const GROQ_PATH = "/openai/v1/chat/completions";
const CEREBRAS_ORIGIN = "https://api.cerebras.ai";
const CEREBRAS_PATH = "/v1/chat/completions";

const http = useMockHttp();

// Expected token counts come from the fixture's OWN usage block, never hardcoded —
// they change on every live re-record. This asserts the field MAPPING (the stable
// contract), not a volatile snapshot value.
function openAiUsage(fixture: WireFixture) {
  const u = (fixture.body as { usage: { prompt_tokens: number; completion_tokens: number } }).usage;
  return { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
}

// Structural guard applied on every path: catches a zero/NaN/undefined usage regression
// that a fixture-derived toEqual alone could let slide.
function expectSaneUsage(usage: { inputTokens: number; outputTokens: number }) {
  expect(Number.isInteger(usage.inputTokens)).toBe(true);
  expect(usage.inputTokens).toBeGreaterThan(0);
  expect(Number.isInteger(usage.outputTokens)).toBe(true);
  expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
}

// The normalized tool-call contract: exactly one call, an id that is SOME non-empty string
// (the provider mints volatile ids — "eqqrhevy4" this record), and the real payload —
// name + parsed arguments — pinned exactly.
function expectWeatherToolCall(res: { toolCalls: { id: string; name: string; arguments: unknown }[] }) {
  expect(res.toolCalls).toHaveLength(1);
  const [call] = res.toolCalls;
  expect(typeof call.id).toBe("string");
  expect(call.id.length).toBeGreaterThan(0);
  expect(call.name).toBe("get_weather");
  expect(call.arguments).toEqual({ city: "Berlin" });
}

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
    const fixture = loadFixture("groq/text.json");
    http.intercept(GROQ_ORIGIN, GROQ_PATH, fixture);

    const res = await groq().chat(TEXT_REQUEST);

    expect(res.text).toBe("The quick brown fox.");
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toEqual(openAiUsage(fixture));
    expectSaneUsage(res.usage);
    expect(res.provider).toBe("groq");
  });

  test("Groq: parses tool_calls JSON-string arguments into the one internal shape", async () => {
    const fixture = loadFixture("groq/toolcall.json");
    http.intercept(GROQ_ORIGIN, GROQ_PATH, fixture);

    const res = await groq().chat(TOOLCALL_REQUEST);

    expect(res.text).toBeNull();
    expectWeatherToolCall(res);
    expect(res.usage).toEqual(openAiUsage(fixture));
    expectSaneUsage(res.usage);
  });

  test("Cerebras: SAME class serves a different base URL (text)", async () => {
    http.intercept(CEREBRAS_ORIGIN, CEREBRAS_PATH, loadFixture("cerebras/text.json"));

    const res = await cerebras().chat(TEXT_REQUEST);

    expect(res.text).toBe("The quick brown fox.");
    expect(res.provider).toBe("cerebras");
    expect(res.model).toBe("llama-3.3-70b"); // echoes the configured model
  });

  test("Cerebras: normalizes tool_calls (same class, different base URL)", async () => {
    http.intercept(CEREBRAS_ORIGIN, CEREBRAS_PATH, loadFixture("cerebras/toolcall.json"));

    const res = await cerebras().chat(TOOLCALL_REQUEST);

    expectWeatherToolCall(res);
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
                {
                  id: "call_bad",
                  type: "function",
                  function: { name: "get_weather", arguments: "{not json" },
                },
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
