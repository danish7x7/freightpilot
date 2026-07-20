import { describe, expect, test } from "vitest";
import { loadLlmConfig } from "../../src/llm/config.js";
import { ConfigError } from "../../src/llm/errors.js";

const KEYS = {
  GEMINI_API_KEY: "g-key",
  GROQ_API_KEY: "q-key",
  CEREBRAS_API_KEY: "c-key",
};

describe("loadLlmConfig", () => {
  test("parses provider:model pairs into a resolved chain with pinned base URLs", () => {
    const cfg = loadLlmConfig({
      LLM_CHAIN: "gemini:gemini-2.5-flash,groq:llama-3.3-70b-versatile,cerebras:llama-3.3-70b",
      ...KEYS,
    });

    expect(cfg.chain.map((c) => [c.name, c.kind, c.model])).toEqual([
      ["gemini", "gemini", "gemini-2.5-flash"],
      ["groq", "openai-compat", "llama-3.3-70b-versatile"],
      ["cerebras", "openai-compat", "llama-3.3-70b"],
    ]);
    expect(cfg.chain[0].baseUrl).toBe("https://generativelanguage.googleapis.com");
    expect(cfg.chain[1].baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(cfg.chain[2].baseUrl).toBe("https://api.cerebras.ai/v1");
    expect(cfg.timeoutMs).toBe(8000);
  });

  test("applies per-provider default RPM and honors overrides", () => {
    const cfg = loadLlmConfig({
      LLM_CHAIN: "gemini:gemini-2.5-flash,groq:llama-3.3-70b-versatile",
      GEMINI_RPM: "5",
      ...KEYS,
    });
    expect(cfg.chain[0].rpm).toBe(5); // override
    expect(cfg.chain[1].rpm).toBe(30); // groq default
  });

  test("throws when LLM_CHAIN is missing", () => {
    expect(() => loadLlmConfig({ ...KEYS })).toThrow(ConfigError);
  });

  test("throws on a malformed entry (no provider:model colon)", () => {
    expect(() => loadLlmConfig({ LLM_CHAIN: "gemini", ...KEYS })).toThrow(/expected provider:model/);
  });

  test("throws on an unknown provider", () => {
    expect(() => loadLlmConfig({ LLM_CHAIN: "openai:gpt-4o", ...KEYS })).toThrow(/Unknown provider/);
  });

  test("throws when a chained provider is missing its API key", () => {
    expect(() =>
      loadLlmConfig({ LLM_CHAIN: "gemini:gemini-2.5-flash" }),
    ).toThrow(/GEMINI_API_KEY is required/);
  });

  test("throws on a non-numeric RPM", () => {
    expect(() =>
      loadLlmConfig({ LLM_CHAIN: "groq:llama-3.3-70b-versatile", GROQ_RPM: "fast", ...KEYS }),
    ).toThrow(/GROQ_RPM must be a positive integer/);
  });
});
