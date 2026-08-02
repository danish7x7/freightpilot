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
  /** What we ASKED for: the configured alias, echoed back. */
  model?: string;
  /** What ANSWERED: read off the response body. See the servedModel test below. */
  servedModel?: string;
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

  /**
   * The SERVED model, which is a different claim from the one above and the one that matters.
   *
   * `model` is the configured alias echoed back: every committed recording says
   * `gemini-flash-latest` because that is the string we sent, not because anything checked what
   * answered. ADR-0007 pins the primary to that alias, its backing model has already rotated once
   * (to a thinking model) with no line changing in this repo, and Amendment A5 requires a re-record
   * rather than a re-run when it does. Comparing `gemini-flash-latest` to `gemini-flash-latest`
   * cannot see that, so this asserts the resolved version is present in the bytes.
   *
   * What this test does and does not give you: it makes a rotation AUDITABLE after the fact, by
   * guaranteeing the resolved version is on disk to be compared. It does not DETECT one. Record
   * mode skips any key that already has a fixture, so an unchanged prompt means an unchanged key
   * means a re-record that calls nothing. Purging the recordings is still the operator's job.
   *
   * WRITTEN STRICTLY AND EXPECTED RED UNTIL THE v1 CAPTURE. No v0-none recording carries the field,
   * because the field did not exist when they were captured, and those fixtures are about to be
   * invalidated wholesale by the PROMPT_VERSION bump anyway. Relaxing this to "assert only where
   * present" would make it pass today and pass forever afterwards on a set that has silently lost
   * the field, which is the defect it exists to catch.
   */
  test("every non-error recording names the SERVED model, not just the requested alias", () => {
    const unlabelled = committedRecordings()
      .filter(({ body }) => body.eval_provider_error === undefined)
      .filter(({ body }) => typeof body.servedModel !== "string" || body.servedModel.length === 0)
      .map(({ file }) => file);

    expect(
      unlabelled,
      `${unlabelled.length} non-error recording(s) carry no servedModel.\n` +
        "  Before the v1 capture this is EXPECTED: the field postdates the v0-none fixtures.\n" +
        "  After the capture, a name here means the adapter or sanitizeResponse stopped\n" +
        "  forwarding it and the fixture set has lost its provenance.",
    ).toEqual([]);
  });

  /**
   * ONE served model across the whole set, not merely a served model on each recording.
   *
   * The test above checks PRESENCE. Presence alone passes a set stitched together from two
   * different backing models, which is exactly the shape a multi-day capture produces when the
   * alias rotates between sessions.
   *
   * This is not hypothetical. `gemini-flash-latest` resolved to `gemini-3.6-flash` during the
   * 2026-08-01 v1 capture, a rotation nothing in this repo requested and no line of it recorded.
   * That capture then hit a quota wall at 20 of 43 calls, so it is a MULTI-DAY capture by
   * necessity: the remaining calls will be served by whatever the alias points at whenever the
   * quota window reopens. If it points somewhere new, the resumed run fills the gaps from a
   * different backing model and the committed set silently becomes half one model, half another,
   * while every per-recording assertion in this file still passes.
   *
   * That is the mixed-provenance defect L5-C9's all-or-nothing-per-`prompt_version` property
   * exists to prevent, arriving through a door L5-C9's own wording does not cover: the capture is
   * complete, every call has a fixture, and the provider is `gemini` throughout. Only the
   * DISTRIBUTION of served models shows it.
   *
   * Same caveat as the test above, and it is the load-bearing one: this makes a rotation
   * AUDITABLE, not self-detecting. Record mode skips any key that already has a fixture, so
   * nothing here forces a re-fetch. When this goes red the fix is to `rm -f` the recordings and
   * capture again from scratch. The purge is the enforcement; this test is only what tells the
   * operator the purge is owed.
   *
   * Uniformity is asserted over recordings that HAVE the field, deliberately. Presence is the
   * previous test's job, and folding the two together would report one failure for two unrelated
   * defects. There is no gap between them: a set that lost the field on some slice fails there.
   */
  test("the whole fixture set was served by ONE model — a rotation mid-capture is mixed provenance", () => {
    const byServedModel = new Map<string, string[]>();
    for (const { file, body } of committedRecordings()) {
      if (body.eval_provider_error !== undefined) continue;
      if (typeof body.servedModel !== "string" || body.servedModel.length === 0) continue;
      const files = byServedModel.get(body.servedModel) ?? [];
      files.push(file);
      byServedModel.set(body.servedModel, files);
    }

    const distinct = [...byServedModel.keys()].sort();
    const breakdown = distinct
      .map((m) => `      ${m}: ${byServedModel.get(m)!.length} recording(s), e.g. ${byServedModel.get(m)![0]}`)
      .join("\n");

    expect(
      distinct,
      `the committed set was served by ${distinct.length} different models:\n${breakdown}\n` +
        "  A capture that spans an alias rotation looks exactly like this, and every other\n" +
        "  assertion in this file passes on it. The fix is NOT to relax this test: purge the\n" +
        "  recordings (rm -f) and re-capture in one pass, per L5-C9's all-or-nothing rule.\n" +
        "  Amendment A5's re-record-not-re-run rule is the same instruction from the other side.",
    ).toHaveLength(1);
  });
});
