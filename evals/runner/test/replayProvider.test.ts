import { describe, expect, test } from "vitest";
import { ReplayProvider, sanitizeResponse } from "../src/replayProvider.js";
import type { ChatRequest, ChatResponse } from "../src/agent.js";
import { recordingKey } from "../src/recordingKey.js";
import { tempDir, writeRecording } from "./helpers.js";

const REQ: ChatRequest = {
  messages: [{ role: "user", content: "hello" }],
  tools: [{ name: "t", parameters: { type: "object" } }],
};

describe("ReplayProvider (§3)", () => {
  test("replay hit returns the recorded response", async () => {
    const dir = tempDir("replayhit");
    const recorded: ChatResponse = {
      text: "hi there",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      provider: "gemini",
      model: "gemini-2.5-flash",
    };
    writeRecording(dir, recordingKey(REQ), recorded);

    const provider = new ReplayProvider({ mode: "replay", recordingsDir: dir });
    await expect(provider.chat(REQ)).resolves.toEqual(recorded);
  });

  test("replay MISS throws — never falls through to a live call ($0 CI, Prime Directive 4)", async () => {
    const dir = tempDir("replaymiss");
    const provider = new ReplayProvider({ mode: "replay", recordingsDir: dir });
    await expect(provider.chat(REQ)).rejects.toThrow(/no recording for key/);
  });

  test("record mode requires a real inner provider", () => {
    const dir = tempDir("recordguard");
    expect(() => new ReplayProvider({ mode: "record", recordingsDir: dir })).toThrow(/requires a real/);
  });

  test("sanitizeResponse keeps only normalized fields and pins tool-call ids", () => {
    const dirty = {
      text: null,
      toolCalls: [{ id: "server-generated-77", name: "search_rates", arguments: { origin: "CNSHA" } }],
      usage: { inputTokens: 3, outputTokens: 2 },
      provider: "gemini",
      model: "gemini-2.5-flash",
      thoughtSignature: "SHOULD-NOT-SURVIVE",
    } as unknown as ChatResponse;
    const clean = sanitizeResponse(dirty);
    expect(clean.toolCalls[0].id).toBe("call_0");
    expect(Object.keys(clean).sort()).toEqual(["model", "provider", "text", "toolCalls", "usage"]);
    expect((clean as unknown as Record<string, unknown>).thoughtSignature).toBeUndefined();
  });
});
