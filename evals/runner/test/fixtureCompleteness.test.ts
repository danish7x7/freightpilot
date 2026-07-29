import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { LlmRouter, TokenBucket, type ChatRequest, type ChatResponse, type LlmProvider } from "../src/agent.js";
import { caseSchema } from "../src/caseSchema.js";
import { loadCases } from "../src/loadCases.js";
import { PROMPT_VERSION } from "../src/promptVersion.js";
import { recordingKey } from "../src/recordingKey.js";
import { ReplayMissError, ReplayProvider } from "../src/replayProvider.js";
import { scoreCase } from "../src/score.js";
import { keyForMessage, tempDir, toolCallResponse, writeRecording } from "./helpers.js";

/**
 * Capture-completeness guard (guardian condition C9, amended).
 *
 * The recordings directory is ALL-OR-NOTHING per `prompt_version`. A capture interrupted by a
 * free-tier quota cap must never reach a branch half-committed — that state has already cost this
 * project two sessions, and it surfaces today only as a `ReplayMissError` stack trace thrown from
 * whichever arbitrary case happened to run first. That is a terrible signal: it reads as "the
 * runner crashed", not "the capture is incomplete".
 *
 * The load-bearing detail is that this counts **expected LLM calls, not cases**. A per-case
 * "has at least one recording" check passes on a half-captured MULTI-CALL case — the loop's
 * Zod-retry path fires a second request with a different key, and a case that made two calls and
 * recorded one is an incomplete capture. Driving each case through the real scorer against the
 * committed recordings is what makes the count exact: every call the loop actually issues must
 * find a committed fixture, however many that turns out to be.
 *
 * This resolves hazard H5: the zero-weight validation-retry case (PR B) is the first two-call case
 * in the suite, and a single-recording result for it is a FAILED capture, not a partial success.
 */

const recordingsDir = fileURLToPath(new URL("../src/recordings", import.meta.url));
const casesDir = fileURLToPath(new URL("../../cases", import.meta.url));

/** Counts calls and remembers which ones missed, instead of letting the first miss abort. */
class CountingReplayProvider implements LlmProvider {
  readonly name = "replay-counting";
  readonly model = "replay";
  readonly supportsTools = true;
  calls = 0;
  misses: string[] = [];
  private readonly inner: ReplayProvider;

  constructor(dir: string = recordingsDir) {
    this.inner = new ReplayProvider({ mode: "replay", recordingsDir: dir });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    try {
      return await this.inner.chat(req);
    } catch (err) {
      if (err instanceof ReplayMissError) this.misses.push(err.message);
      throw err;
    }
  }
}

describe(`committed fixtures are complete for prompt_version=${PROMPT_VERSION}`, () => {
  const cases = loadCases(casesDir);
  const driven = cases.filter((c) => !c.pending);

  test("the case set is non-empty and all but the known pending cases are driven (anti-vacuous)", () => {
    // Pinned to the actual split rather than `> 0`: a mis-pointed casesDir that loaded one case
    // would satisfy a bare non-empty check while making the completeness assertion meaningless.
    const pending = cases.filter((c) => c.pending);
    expect(cases.length).toBeGreaterThan(20);
    expect(driven.length).toBe(cases.length - pending.length);
    expect(pending).toHaveLength(1);
  });

  test("every LLM call every driven case makes has a committed recording", async () => {
    const incomplete: string[] = [];

    for (const c of driven) {
      const provider = new CountingReplayProvider();
      const makeRouter = () =>
        new LlmRouter([{ provider, bucket: new TokenBucket({ rpm: 1_000_000 }) }]);
      try {
        // scoreCase swallows genuinely-replayed provider errors (a frozen 400 is a legitimate
        // recorded outcome) and rethrows everything else — a miss included.
        await scoreCase(c, { makeRouter });
      } catch (err) {
        if (!(err instanceof ReplayMissError)) throw err;
      }
      if (provider.calls === 0) {
        incomplete.push(`${c.id}: made no LLM call at all — the case never reached the model`);
      } else if (provider.misses.length > 0) {
        incomplete.push(
          `${c.id}: made ${provider.calls} call(s), ${provider.misses.length} with NO committed recording ` +
            `— incomplete capture (a multi-call case that recorded only its first call looks like this)`,
        );
      }
    }

    // A non-empty list means the committed set is a PARTIAL capture. Do not commit it; finish the
    // capture (record mode, primary provider only — condition C10) and commit the complete set.
    expect(incomplete).toEqual([]);
  });

  /**
   * The property C9 exists for, proven on a synthetic set rather than left latent.
   *
   * No case in the CURRENT suite makes two LLM calls, so the call-counting logic above is armed but
   * never fires in CI. PR B's zero-weight validation-retry case is the first two-call case, and it
   * is also the most capture-fragile thing in the suite (the second key depends on the first
   * response's bytes). This drives a case whose FIRST recording contains Zod-invalid tool args —
   * which makes the real loop fire a retry — into a fixture dir that deliberately lacks the second
   * recording, and asserts the guard reports an incomplete capture rather than a partial success.
   */
  test("a case whose retry call has no recording is reported as an INCOMPLETE capture", async () => {
    const dir = tempDir("completeness-partial");
    const probe = caseSchema.parse({
      id: "extraction-retry-probe",
      tier: "extraction",
      description: "first call returns invalid args, forcing the loop to retry",
      input: { message: "Quote ocean CNSHA to USOAK on 2026-08-01 for 0 kg of gravel." },
      expect: { kind: "tool", tool: "calculate_quote", args: {} },
    });

    // weight_kg: 0 fails cargoSchema (.gt(0)) → the loop retries with the validation errors, and
    // that second request has a different key with no fixture behind it.
    writeRecording(
      dir,
      keyForMessage(probe.input.message!),
      toolCallResponse("calculate_quote", {
        rate_card_id: "11111111-1111-4111-8111-111111111111",
        shipment: {
          origin_code: "CNSHA",
          dest_code: "USOAK",
          ship_date: "2026-08-01",
          cargo: { weight_kg: 0, description: "gravel" },
        },
      }),
    );

    const provider = new CountingReplayProvider(dir);
    const makeRouter = () => new LlmRouter([{ provider, bucket: new TokenBucket({ rpm: 1_000_000 }) }]);
    try {
      await scoreCase(probe, { makeRouter });
    } catch (err) {
      if (!(err instanceof ReplayMissError)) throw err;
    }

    expect(provider.calls).toBe(2);
    expect(provider.misses).toHaveLength(1);
  });

  test("the recordings directory has no fixture that no case claims", async () => {
    const unclaimed = new Set(readdirSync(recordingsDir).filter((f) => f.endsWith(".json")));
    const inner = new ReplayProvider({ mode: "replay", recordingsDir });

    for (const c of driven) {
      const tracking: LlmProvider = {
        name: "replay-tracking",
        model: "replay",
        supportsTools: true,
        chat: async (req) => {
          unclaimed.delete(`${recordingKey(req)}.json`);
          return inner.chat(req);
        },
      };
      const makeRouter = () =>
        new LlmRouter([{ provider: tracking, bucket: new TokenBucket({ rpm: 1_000_000 }) }]);
      try {
        await scoreCase(c, { makeRouter });
      } catch (err) {
        if (!(err instanceof ReplayMissError)) throw err;
      }
    }

    // Orphans are stale bytes from a superseded capture: harmless to replay, but they make the
    // fixture set's provenance unauditable by inspection and they survive the `prompt_version`
    // bumps that should have invalidated them.
    expect([...unclaimed].sort()).toEqual([]);
  });
});
