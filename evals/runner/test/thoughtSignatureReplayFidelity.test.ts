import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { ChatRequest, ChatResponse, LlmProvider, NormalizedToolCall } from "../src/agent.js";
import { recordingKey } from "../src/recordingKey.js";
import { ReplayProvider, sanitizeResponse } from "../src/replayProvider.js";
import { tempDir } from "./helpers.js";

/**
 * A RECORDED retry chain must replay byte-for-byte identically to a live one.
 *
 * `thoughtSignature` is the only field in a `ChatResponse` that feeds back into the NEXT request:
 * `agentLoop` appends the assistant tool call to the conversation before retrying, and
 * `recordingKey` hashes `req.messages`. So the signature sits inside the key material of the
 * second call. Strip it when recording and the replayed retry hashes different bytes from the live
 * one, misses its own committed fixture, and dies as a `ReplayMissError`.
 *
 * That failure would be maximally confusing: the fixture IS on disk, under a key nothing computes
 * any more. The 2026-08-02 capture already showed the neighbouring failure mode (the signature was
 * dropped at the ADAPTER, so the second call 400'd live), and the two look nothing alike from the
 * outside.
 *
 * `services/agent/test/llm/thoughtSignatureRoundTrip.test.ts` guards the adapter half. This guards
 * the RECORDING half, which is a separate mutation surface: `sanitizeResponse` is an allowlist
 * rebuild, so a field is dropped simply by not being named there.
 *
 * ZERO QUOTA — the "live" provider here is a stub.
 *
 * WHAT BREAKS THESE TESTS:
 *   - remove `thoughtSignature` from sanitizeResponse's rebuild -> both tests fail
 *   - record the raw response instead of the sanitized one      -> unaffected (still correct)
 *   - add the signature to recordingKey's material              -> unaffected (already in messages)
 */

const SIGNATURE = "EroDCsYDAdHtim9-OPAQUE-TOKEN-DO-NOT-INTERPRET";

const toolCall: NormalizedToolCall = {
  id: "call_0",
  name: "search_rates",
  arguments: { origin: "CNSHA", dest: "USOAK" },
  thoughtSignature: SIGNATURE,
};

const liveResponse: ChatResponse = {
  text: null,
  toolCalls: [toolCall],
  usage: { inputTokens: 10, outputTokens: 5 },
  provider: "gemini",
  model: "gemini-3.1-flash-lite",
  servedModel: "gemini-3.1-flash-lite",
};

class StubLive implements LlmProvider {
  readonly name = "gemini";
  readonly model = "gemini-3.1-flash-lite";
  readonly supportsTools = true;
  async chat(): Promise<ChatResponse> {
    return liveResponse;
  }
}

/** The second request of a retry chain, built from whatever the first call returned. */
function retryRequest(first: ChatResponse): ChatRequest {
  return {
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "rates CNSHA to USOAK" },
      { role: "assistant", content: first.text ?? "", toolCalls: first.toolCalls },
      { role: "user", content: "dest is required" },
    ],
    tools: [{ name: "search_rates", description: "d", parameters: { type: "object" } }],
  };
}

describe("recorded retry chains replay byte-for-byte", () => {
  test("sanitizeResponse preserves the signature", () => {
    expect(
      sanitizeResponse(liveResponse).toolCalls[0].thoughtSignature,
      "sanitizeResponse dropped thoughtSignature. It is an allowlist rebuild, so this happens by " +
        "simply not naming the field. The recorded set can no longer replay any retry chain.",
    ).toBe(SIGNATURE);
  });

  test("the replayed retry computes the SAME recordingKey as the live one", async () => {
    const dir = tempDir("sigfidelity");

    // LIVE path: key the retry from the provider's RAW response, which is what production sees.
    //
    // Deliberately NOT `recorder.chat(...)`: record mode returns the SANITIZED response
    // (replayProvider.ts:111-113), so keying both sides off it would put both through
    // `sanitizeResponse` and they could never diverge whatever that function drops. That version
    // of this test passed with the field stripped and was therefore worthless — the same
    // tautology shape eval-auditor's Blocking B1 found in PR A.
    const firstLive = await new StubLive().chat();
    const liveKey = recordingKey(retryRequest(firstLive));

    // RECORD path: the same call, through the recorder, so the fixture lands on disk.
    const recorder = new ReplayProvider({ mode: "record", recordingsDir: dir, inner: new StubLive() });
    await recorder.chat({ messages: [{ role: "user", content: "rates CNSHA to USOAK" }] });

    // Replay path: read the committed fixture back off disk and key the retry built from THAT.
    const firstKey = recordingKey({ messages: [{ role: "user", content: "rates CNSHA to USOAK" }] });
    const fromDisk = JSON.parse(readFileSync(join(dir, `${firstKey}.json`), "utf8")) as ChatResponse;
    const replayKey = recordingKey(retryRequest(fromDisk));

    expect(
      replayKey,
      "the replayed retry hashes different bytes from the live one, so it will MISS its own " +
        "committed fixture. The fixture is on disk under a key nothing computes any more.",
    ).toBe(liveKey);
  });
});
