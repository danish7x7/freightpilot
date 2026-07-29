import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Provenance guard for the COMMITTED fixture set (ADR-0011 finding (a), the durable version).
 *
 * Finding (a) was not "Gemini rejects `exclusiveMinimum`" — that was the mechanism. The DEFECT
 * was that the rejection was INVISIBLE: the primary 400'd non-retryably, the router fell through
 * to Groq, every fixture was captured from the fallback, and the suite reported a confident green
 * baseline for a chain whose primary could not serve a single request. Nothing in the harness
 * noticed, because the recording key excludes `provider` (deliberately — §3) and no test ever
 * looked at the bytes.
 *
 * The keyword allowlist in services/agent/test/tools/geminiSchemaCompat.test.ts guards the known
 * mechanism. THIS guards the observable symptom, whatever the next mechanism turns out to be: if
 * the committed baseline was served by anything other than the declared primary, fail.
 *
 * Deliberately asserts against a hardcoded expectation rather than reading LLM_CHAIN — the point
 * is to pin what the committed bytes ARE, and an env-derived expectation would follow a
 * mis-pointed capture straight into a green run.
 */

// The primary the committed v0-none baseline must have been captured from (ADR-0007 pins the
// live chain to `gemini-flash-latest`, an alias, because `gemini-2.5-flash` 404s for new keys).
const EXPECTED_PROVIDER = "gemini";

const recordingsDir = fileURLToPath(new URL("../src/recordings", import.meta.url));

interface Recording {
  provider?: string;
  model?: string;
  /** An error envelope persists its provider one level down — see replayProvider.ts. */
  eval_provider_error?: { provider?: string };
}

/**
 * The provider a recording came from, whether it is a normal response or a recorded error.
 * Error envelopes must NOT be exempt from the provenance check: a recorded Groq error is
 * precisely how a fallback-served fixture would re-enter the committed set (ADR-0011 finding
 * (b) is still open and is the likely source of one at L5), so it is checked like any other.
 */
function providerOf(body: Recording): string | undefined {
  return body.eval_provider_error ? body.eval_provider_error.provider : body.provider;
}

function committedRecordings(): { file: string; body: Recording }[] {
  return readdirSync(recordingsDir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({
      file,
      body: JSON.parse(readFileSync(join(recordingsDir, file), "utf8")) as Recording,
    }));
}

describe("committed recordings' provenance", () => {
  test("the fixture set is non-empty (a vacuous pass would defeat every assertion below)", () => {
    expect(committedRecordings().length).toBeGreaterThan(0);
  });

  test("every recording was served by the declared PRIMARY provider, not a fallback", () => {
    const offenders = committedRecordings()
      .filter(({ body }) => providerOf(body) !== EXPECTED_PROVIDER)
      .map(({ file, body }) => `${file}: provider=${String(providerOf(body))}`);

    // A non-empty list means the baseline silently came from a fallback — i.e. the primary was
    // rejecting requests and the suite went green anyway. That is ADR-0011 finding (a) exactly.
    expect(offenders).toEqual([]);
  });

  test("the fixture set is single-provider — no half-captured, mixed-provenance baseline", () => {
    const providers = new Set(committedRecordings().map(({ body }) => providerOf(body)));
    expect([...providers]).toEqual([EXPECTED_PROVIDER]);
  });

  test("every non-error recording names the model it came from, so provenance is auditable", () => {
    // Error envelopes carry no model (replayProvider persists {kind, provider, status, message}),
    // so the model label is asserted only where one exists to assert.
    const unlabelled = committedRecordings()
      .filter(({ body }) => body.eval_provider_error === undefined)
      .filter(({ body }) => typeof body.model !== "string" || body.model.length === 0)
      .map(({ file }) => file);
    expect(unlabelled).toEqual([]);
  });
});
