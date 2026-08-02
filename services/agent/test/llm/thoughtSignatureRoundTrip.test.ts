import { describe, expect, test, vi, afterEach } from "vitest";
import { GeminiProvider } from "../../src/llm/geminiProvider.js";

/**
 * Gemini thinking models require the `thoughtSignature` issued on a `functionCall` part to be
 * echoed back when that assistant turn is re-sent. Omit it and the API answers a NON-RETRYABLE
 * 400 ("Function call is missing a thought_signature in functionCall parts"), which the router
 * surfaces instead of falling back, so the turn dies.
 *
 * That is EVERY RETRY the loop makes: `agentLoop` appends the assistant tool call to the
 * conversation and calls again. So a dropped signature does not degrade the retry path, it
 * deletes it, and only on the second call — the first call of every case still works, which is
 * why the 2026-08-01 v1 capture looked healthy on 42 of 44 calls and froze two 400s.
 *
 * ZERO QUOTA. Both calls are stubbed at `fetch`; nothing here touches a provider.
 *
 * WHAT BREAKS THESE TESTS:
 *   - drop `thoughtSignature: part.thoughtSignature` when reading a response  -> test 1 fails
 *   - drop the `part.thoughtSignature = tc.thoughtSignature` re-emit          -> test 2 fails
 *   - nest the signature INSIDE `functionCall` instead of beside it           -> test 2 fails
 *   - echo a value other than the one received                               -> test 3 fails
 *
 * The tests assert PRESENCE, POSITION and ROUND-TRIP EQUALITY only. They never assert what a
 * signature contains: it is an opaque provider token (see NormalizedToolCall.thoughtSignature).
 */

const SIGNATURE = "EroDCsYDAdHtim9-OPAQUE-TOKEN-DO-NOT-INTERPRET";

function makeProvider(): GeminiProvider {
  return new GeminiProvider({
    name: "gemini",
    model: "gemini-3.1-flash-lite",
    apiKey: "test-key",
    baseUrl: "https://example.invalid",
    timeoutMs: 5000,
  });
}

/** A response whose single part is a functionCall carrying a signature beside it. */
function toolCallResponseBody(): unknown {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: { name: "search_rates", args: { origin: "CNSHA", dest: "USOAK" } },
              thoughtSignature: SIGNATURE,
            },
          ],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    modelVersion: "gemini-3.1-flash-lite",
  };
}

function stubFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** The request body the provider actually sent, parsed. */
function sentBody(fn: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const init = fn.mock.calls[call][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini thoughtSignature round-trip", () => {
  test("reads the signature off an incoming functionCall part", async () => {
    stubFetch(toolCallResponseBody());
    const res = await makeProvider().chat({ messages: [{ role: "user", content: "rates CNSHA to USOAK" }] });

    expect(res.toolCalls).toHaveLength(1);
    expect(
      res.toolCalls[0].thoughtSignature,
      "the signature was not carried onto the normalized tool call; every retry against a " +
        "thinking model will now 400 non-retryably",
    ).toBe(SIGNATURE);
  });

  test("re-emits it BESIDE functionCall when the assistant turn is sent back", async () => {
    const fn = stubFetch(toolCallResponseBody());
    await makeProvider().chat({
      messages: [
        { role: "user", content: "rates CNSHA to USOAK" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_0", name: "search_rates", arguments: { origin: "CNSHA" }, thoughtSignature: SIGNATURE }],
        },
        { role: "user", content: "that call was invalid, try again" },
      ],
    });

    const contents = sentBody(fn).contents as { role: string; parts: Record<string, unknown>[] }[];
    const modelTurn = contents.find((c) => c.role === "model");
    const fcPart = modelTurn?.parts.find((p) => p.functionCall !== undefined);

    expect(fcPart, "no functionCall part was sent for the assistant turn").toBeDefined();
    expect(
      fcPart!.thoughtSignature,
      "the functionCall part went out without its thoughtSignature — this is the exact shape " +
        "that produced the two frozen 400s in the 2026-08-01 capture",
    ).toBe(SIGNATURE);
    // Position matters: the API wants it on the PART, not inside functionCall.
    expect(fcPart!.functionCall).not.toHaveProperty("thoughtSignature");
  });

  test("a full two-call chain sends back exactly the signature the first call returned", async () => {
    // Call 1: live-shaped response carrying the signature.
    const fn = stubFetch(toolCallResponseBody());
    const provider = makeProvider();
    const first = await provider.chat({ messages: [{ role: "user", content: "rates CNSHA to USOAK" }] });

    // Call 2: the loop's retry shape — the assistant turn is rebuilt FROM the first response,
    // exactly as agentLoop does, with no hand-written signature anywhere in this test.
    await provider.chat({
      messages: [
        { role: "user", content: "rates CNSHA to USOAK" },
        { role: "assistant", content: first.text ?? "", toolCalls: first.toolCalls },
        { role: "user", content: "dest is required" },
      ],
    });

    const contents = sentBody(fn, 1).contents as { role: string; parts: Record<string, unknown>[] }[];
    const fcPart = contents.find((c) => c.role === "model")!.parts.find((p) => p.functionCall !== undefined)!;
    expect(fcPart.thoughtSignature).toBe(first.toolCalls[0].thoughtSignature);
    expect(fcPart.thoughtSignature).toBe(SIGNATURE);
  });

  test("a provider that issues no signature sends a part with no signature key at all", async () => {
    const body = toolCallResponseBody() as { candidates: { content: { parts: Record<string, unknown>[] } }[] };
    delete body.candidates[0].content.parts[0].thoughtSignature;
    const fn = stubFetch(body);
    const provider = makeProvider();
    const first = await provider.chat({ messages: [{ role: "user", content: "rates" }] });
    expect(first.toolCalls[0].thoughtSignature).toBeUndefined();

    await provider.chat({
      messages: [
        { role: "user", content: "rates" },
        { role: "assistant", content: "", toolCalls: first.toolCalls },
      ],
    });
    const contents = sentBody(fn, 1).contents as { role: string; parts: Record<string, unknown>[] }[];
    const fcPart = contents.find((c) => c.role === "model")!.parts.find((p) => p.functionCall !== undefined)!;
    // Absent, not `undefined`-valued: the wire body for a non-thinking model is byte-identical to
    // what it was before this field existed.
    expect(Object.keys(fcPart)).toEqual(["functionCall"]);
  });
});
