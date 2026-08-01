import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { collectServedModels, ReplayProvider, sanitizeResponse } from "../src/replayProvider.js";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/agent.js";
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
    expect(Object.keys(clean).sort()).toEqual(["model", "provider", "servedModel", "text", "toolCalls", "usage"]);
    expect((clean as unknown as Record<string, unknown>).thoughtSignature).toBeUndefined();
  });

  /**
   * MUTATION: delete `servedModel: res.servedModel` from sanitizeResponse.
   *
   * sanitizeResponse is an ALLOWLIST, so a field the adapters parse but it does not name is
   * silently dropped on the way to disk. That failure is invisible by construction: the type says
   * the field exists, the adapter populates it, and every committed byte lacks it. This drives the
   * real record path and asserts against the FILE rather than the return value, because the return
   * value would still carry the field if only the write were broken.
   */
  test("a served model survives sanitize and reaches the committed recording bytes", async () => {
    const dir = tempDir("served-model");
    const live: ChatResponse = {
      text: "ok",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      provider: "gemini",
      model: "gemini-flash-latest",
      servedModel: "gemini-2.5-flash-preview-09-2025",
    };
    const inner: LlmProvider = {
      name: "fake",
      model: "gemini-flash-latest",
      supportsTools: true,
      chat: async () => live,
    };

    const provider = new ReplayProvider({ mode: "record", recordingsDir: dir, inner });
    await provider.chat(REQ);

    const onDisk = JSON.parse(readFileSync(join(dir, `${recordingKey(REQ)}.json`), "utf8")) as ChatResponse;
    // The alias and what answered are BOTH present and DIFFERENT. Asserting they differ is the
    // point: equal values would mean the field was populated from config rather than the response.
    expect(onDisk.servedModel).toBe("gemini-2.5-flash-preview-09-2025");
    expect(onDisk.model).toBe("gemini-flash-latest");
    expect(onDisk.servedModel).not.toBe(onDisk.model);
  });

  test("a provider that supplies no served model writes no key, rather than a null", async () => {
    const dir = tempDir("served-model-absent");
    const inner: LlmProvider = {
      name: "fake",
      model: "some-model",
      supportsTools: true,
      chat: async () => ({
        text: "ok",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        provider: "fake",
        model: "some-model",
      }),
    };
    const provider = new ReplayProvider({ mode: "record", recordingsDir: dir, inner });
    await provider.chat(REQ);

    // JSON.stringify drops undefined, so absence stays absence in the bytes. This matters for the
    // provenance guard: a recording with `servedModel: null` would satisfy a naive presence check
    // while carrying no provenance at all.
    const raw = readFileSync(join(dir, `${recordingKey(REQ)}.json`), "utf8");
    expect(raw).not.toMatch(/servedModel/);
  });

  /**
   * CHARACTERIZATION test: pins current behavior so the purge step in the recordings README is
   * load-bearing rather than folklore. It is not asserting that this behavior is desirable.
   *
   * Record mode short-circuits on an existing fixture, which is what makes an interrupted capture
   * resumable without re-paying for cases already captured. The cost is that an alias rotation
   * with an UNCHANGED prompt produces unchanged keys, so `pnpm run record` makes zero live calls
   * and refreshes nothing while the scorecard goes on stamping the stale served model with full
   * confidence. Amendment A5's "re-record, not re-run" therefore still needs an operator to purge
   * the directory first; `servedModel` makes the rotation auditable, not self-detecting.
   */
  test("record mode over an EXISTING recording makes no live call, so a rotation needs a purge", async () => {
    const dir = tempDir("record-shortcircuit");
    const base = { text: "x", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, provider: "gemini", model: "gemini-flash-latest" };
    writeRecording(dir, recordingKey(REQ), { ...base, servedModel: "BEFORE-rotation" });

    let liveCalls = 0;
    const inner: LlmProvider = {
      name: "gemini",
      model: "gemini-flash-latest",
      supportsTools: true,
      chat: async () => {
        liveCalls += 1;
        return { ...base, servedModel: "AFTER-rotation" } as ChatResponse;
      },
    };

    await new ReplayProvider({ mode: "record", recordingsDir: dir, inner }).chat(REQ);

    expect(liveCalls).toBe(0);
    const onDisk = JSON.parse(readFileSync(join(dir, `${recordingKey(REQ)}.json`), "utf8")) as ChatResponse;
    expect(onDisk.servedModel).toBe("BEFORE-rotation");
    expect(collectServedModels(dir)).toEqual(["BEFORE-rotation"]);
  });

  describe("collectServedModels", () => {
    test("returns the SORTED DISTINCT set, so a mid-capture rotation is visible", () => {
      const dir = tempDir("collect-served");
      const base = { text: "x", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, provider: "gemini" };
      writeRecording(dir, "aaa", { ...base, model: "gemini-flash-latest", servedModel: "v-two" });
      writeRecording(dir, "bbb", { ...base, model: "gemini-flash-latest", servedModel: "v-one" });
      // Duplicate of the first: the set must collapse it rather than reporting it twice.
      writeRecording(dir, "ccc", { ...base, model: "gemini-flash-latest", servedModel: "v-two" });
      // An error envelope carries no model at all and must be skipped, not counted as a gap.
      writeRecording(dir, "ddd", {
        eval_provider_error: { kind: "client", provider: "gemini", status: 400, message: "fixture" },
      });

      expect(collectServedModels(dir)).toEqual(["v-one", "v-two"]);
    });

    test("a set of two IS the rotation signal, not an error to smooth over", () => {
      // Guards the decision to stamp a set rather than a scalar. A scalar would have to pick one of
      // these and would then be false for the other half of the capture.
      const dir = tempDir("collect-rotation");
      const base = { text: "x", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, provider: "gemini" };
      writeRecording(dir, "aaa", { ...base, model: "gemini-flash-latest", servedModel: "before-rotation" });
      writeRecording(dir, "bbb", { ...base, model: "gemini-flash-latest", servedModel: "after-rotation" });
      expect(collectServedModels(dir)).toHaveLength(2);
    });

    test("a directory that does not exist yields an empty set, not a crash", () => {
      expect(collectServedModels(join(tempDir("collect-missing"), "nope"))).toEqual([]);
    });
  });
});
