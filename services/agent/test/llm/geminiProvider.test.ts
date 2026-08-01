import { describe, expect, test } from "vitest";
import { GeminiProvider } from "../../src/llm/geminiProvider.js";
import { loadFixture, type WireFixture } from "../fixtures/load.js";
import { TEXT_REQUEST, TOOLCALL_REQUEST } from "../fixtures/throwawayTool.js";
import { useMockHttp } from "./mockHttp.js";

const ORIGIN = "https://generativelanguage.googleapis.com";
// The model we configure the provider with. res.model echoes THIS: the model we asked for.
// `res.servedModel` is the OTHER half and is read from the response's own `modelVersion`; see the
// served-model tests at the bottom of this file. (This comment previously said modelVersion was
// deliberately not surfaced. That decision was reversed: `gemini-flash-latest` is an ALIAS, and
// Amendment A5's "an alias change requires a re-record, not a re-run" cannot be enforced while both
// sides of the comparison read the alias.) Derive both the URL and the assertion from this constant
// so neither goes stale on a re-record.
const MODEL = "gemini-flash-latest";
const PATH = `/v1beta/models/${MODEL}:generateContent`;

const http = useMockHttp();

// Expected token counts come from the fixture's OWN usage metadata, never hardcoded —
// they change on every live re-record. This asserts the field MAPPING (the stable
// contract), not a volatile snapshot value.
function geminiUsage(fixture: WireFixture) {
  const u = (
    fixture.body as {
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    }
  ).usageMetadata;
  return { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount };
}

// Structural guard applied on every path: catches a zero/NaN/undefined usage regression
// that a fixture-derived toEqual alone could let slide.
function expectSaneUsage(usage: { inputTokens: number; outputTokens: number }) {
  expect(Number.isInteger(usage.inputTokens)).toBe(true);
  expect(usage.inputTokens).toBeGreaterThan(0);
  expect(Number.isInteger(usage.outputTokens)).toBe(true);
  expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
}

function provider(): GeminiProvider {
  return new GeminiProvider({
    name: "gemini",
    model: MODEL,
    apiKey: "test-key",
    baseUrl: ORIGIN,
    timeoutMs: 8000,
  });
}

describe("GeminiProvider (replay)", () => {
  test("normalizes a plain text completion + usage", async () => {
    const fixture = loadFixture("gemini/text.json");
    http.intercept(ORIGIN, PATH, fixture);

    const res = await provider().chat(TEXT_REQUEST);

    expect(res.text).toBe("The quick brown fox.");
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toEqual(geminiUsage(fixture));
    expectSaneUsage(res.usage);
    expect(res.provider).toBe("gemini");
    expect(res.model).toBe(MODEL);
  });

  test("normalizes a Gemini functionCall to the one internal tool-call shape", async () => {
    const fixture = loadFixture("gemini/toolcall.json");
    http.intercept(ORIGIN, PATH, fixture);

    const res = await provider().chat(TOOLCALL_REQUEST);

    expect(res.text).toBeNull();
    // Gemini sends no reusable call id, so we synthesize a per-response one (call_<index>).
    // That synthesized shape IS our stable contract; the provider's own id ("xon8cki1" this
    // record) is discarded. name + parsed arguments are the real normalization contract.
    expect(res.toolCalls).toEqual([
      { id: "call_0", name: "get_weather", arguments: { city: "Berlin" } },
    ]);
    expect(res.usage).toEqual(geminiUsage(fixture));
    expectSaneUsage(res.usage);
  });

  test("a 200 with no candidate content surfaces as a malformed error (not a fallback)", async () => {
    http.intercept(ORIGIN, PATH, { status: 200, body: { candidates: [{}] } });

    await expect(provider().chat(TEXT_REQUEST)).rejects.toMatchObject({
      name: "LlmError",
      kind: "malformed",
    });
  });

  /**
   * The served model: what ANSWERED, as opposed to `model`, which is what we ASKED FOR.
   *
   * MUTATION: delete `servedModel: root.modelVersion` from geminiProvider's normalize().
   *
   * Synthetic bodies rather than the committed wire fixtures, and that is deliberate: the fixtures
   * were captured and trimmed under the previous contract, when modelVersion was dropped on the
   * floor, so they carry no such field. Re-recording them to add one would spend live calls to
   * assert a field mapping, which is what a synthetic body asserts more directly anyway. The file
   * already uses this style for the malformed-body case above.
   */
  test("servedModel comes from the response's modelVersion, not from the configured alias", async () => {
    http.intercept(ORIGIN, PATH, {
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        modelVersion: "gemini-2.5-flash-preview-09-2025",
      },
    });

    const res = await provider().chat(TEXT_REQUEST);

    // Asserting the two DIFFER is the real content of this test. Equal values would be satisfied
    // by reading cfg.model into both, which is precisely the state this change exists to end.
    expect(res.model).toBe(MODEL);
    expect(res.servedModel).toBe("gemini-2.5-flash-preview-09-2025");
    expect(res.servedModel).not.toBe(res.model);
  });

  test("a response with no modelVersion leaves servedModel UNDEFINED, never the alias", async () => {
    // The committed fixtures predate the field, so they are the honest input here.
    http.intercept(ORIGIN, PATH, loadFixture("gemini/text.json"));

    const res = await provider().chat(TEXT_REQUEST);

    // Guards against "fixing" an absent modelVersion by defaulting to cfg.model. That default
    // would make every recording claim a served model it never observed, which is worse than the
    // gap it papers over: absence is legible, a fabricated label is not.
    expect(res.servedModel).toBeUndefined();
  });
});
