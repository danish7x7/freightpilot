import type { ChatRequest, LlmToolSchema } from "../../src/llm/types.js";

/**
 * A throwaway tool schema + driver prompts used ONLY by tests and the fixture
 * recorder — deliberately NOT a real L2 tool and NOT in src/ (Rule 6: no prompt or
 * tool text lives in production source at L1). Exists solely to shape a tool-call
 * response so normalization can be verified across providers.
 */
export const THROWAWAY_TOOL: LlmToolSchema = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name, e.g. Berlin" },
    },
    required: ["city"],
  },
};

/** Prompt that should yield a plain-text completion. */
export const TEXT_REQUEST: ChatRequest = {
  messages: [{ role: "user", content: "Reply with the sentence: The quick brown fox." }],
};

/** Prompt that should provoke a tool call against THROWAWAY_TOOL. */
export const TOOLCALL_REQUEST: ChatRequest = {
  messages: [{ role: "user", content: "What is the weather in Berlin? Use the tool." }],
  tools: [THROWAWAY_TOOL],
};
