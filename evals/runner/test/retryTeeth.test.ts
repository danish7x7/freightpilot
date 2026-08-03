import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { LlmRouter, TokenBucket, type ChatRequest, type ChatResponse, type LlmProvider } from "../src/agent.js";
import { loadCases } from "../src/loadCases.js";
import { ReplayMissError, ReplayProvider } from "../src/replayProvider.js";
import { scoreCase } from "../src/score.js";

/**
 * HAZARD H5's teeth, asserted at the EVAL layer and named after the mechanism.
 *
 * > "H5. The retry path still has no eval teeth … All existing cases make exactly one LLM call, so
 * > deleting the retry block in `agentLoop.ts:84-96` leaves every eval green."
 *
 * H5 was written when the suite had zero two-call cases. It now has two, so the retry IS exercised
 * over committed bytes. This file is what makes it ASSERTED: exercised-but-unwatched is the same
 * shape as the two other holes this PR found (L5-C15(ii), where `recordingKey` was never checked
 * against a degraded prompt; and ADR-0012 §2.8a, where a real booking side-effect was reached but
 * unobservable). A path being reached is not a guard.
 *
 * WHY THIS EXISTS ALONGSIDE THE GUARDS THAT ALREADY FIRE. Deleting the retry does not go unnoticed —
 * three tests go red — but none of them SAYS SO, which is the complaint ADR-0012 §2B.4 lodges
 * against the status quo ("a mechanism guard should name the mechanism it is guarding"):
 *
 *   - `services/agent/test/loop/agentLoop.test.ts` proves the loop CAN retry, synthetically, one
 *     layer down in agent-service. It does name the mechanism. It says nothing about whether the
 *     shipped eval suite still exercises it.
 *   - `fixtureCompleteness.test.ts` fires twice, and both messages point at the FIXTURES: "a case
 *     whose retry call has no recording is reported as an INCOMPLETE capture" and "the recordings
 *     directory has no fixture that no case claims". A future author reading those reasonably
 *     concludes the recordings are stale and deletes the two orphans — which makes the suite green
 *     again with the retry still gone. That remedy is the hazard.
 *
 * This test's subject is H5's actual claim: does the COMMITTED SUITE still drive a second LLM call.
 *
 * IDENTITY, NOT COUNT, deliberately. `LEARNING.md` (2026-08-02): "asserting a COUNT where you mean
 * an IDENTITY is the commonest way to build [a blind spot]" — a bare "at least one case makes two
 * calls" would stay green if the two-call case were swapped for a different one, which is exactly
 * the substitution H5 is about. The chains are pinned by id.
 *
 * SCOPE — this changes nothing about what any tier measures. It adds no case, edits no `expect`
 * block, and touches no scorer. Per ADR-0012 §2.8a the rule this PR operates under is that changing
 * what a tier measures after seeing a score is unavailable, and that holds even when the direction
 * is stricter. So this asserts the mechanism beside the scorers, never through them. The extraction
 * and tools numbers are identical with and without this file.
 *
 * WHAT IT DOES NOT CLOSE, stated so the DoD is not read as finished: no TIER can fail on a deleted
 * retry. Deleting it flips exactly one scored case (`extraction-missing-destination-clarify`,
 * 20/24 -> 19/24 = 0.7917) against a floor of 0.79, so the gate stays GREEN. See ADR-0012 §2B.4.
 *
 * Hermetic: replay only, zero quota, zero network.
 */

const recordingsDir = fileURLToPath(new URL("../src/recordings", import.meta.url));
const casesDir = fileURLToPath(new URL("../../cases", import.meta.url));

/**
 * The suite's two-call chains, pinned by id.
 *
 * - `tools-validation-retry-pallet-cap` — the DELIBERATE one (H5's case): 250 pallets exceeds
 *   `cargoSchema`'s `.max(100)`, the loop feeds the validation errors back, and a second call is
 *   issued. Captured last, both keys verified (ADR-0012 §2B.4).
 * - `extraction-missing-destination-clarify` — the INCIDENTAL one: the model called `search_rates`
 *   with no `dest`, Zod rejected it, and the retry produced the answer that scores. This is the
 *   case whose flip is the only score-level movement when the retry is deleted (ADR-0012 §2C.2).
 */
const EXPECTED_TWO_CALL_CASES = [
  "extraction-missing-destination-clarify",
  "tools-validation-retry-pallet-cap",
];

class CountingProvider implements LlmProvider {
  readonly name = "counting-replay";
  readonly model = "replay";
  readonly supportsTools = true;
  calls = 0;
  private readonly inner = new ReplayProvider({ mode: "replay", recordingsDir });

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    return this.inner.chat(req);
  }
}

describe("H5: the committed suite still drives the loop's Zod-retry", () => {
  test("exactly the pinned cases make more than one LLM call", async () => {
    const driven = loadCases(casesDir).filter((c) => !c.pending);
    const callCounts = new Map<string, number>();

    for (const c of driven) {
      const provider = new CountingProvider();
      const makeRouter = () =>
        new LlmRouter([{ provider, bucket: new TokenBucket({ rpm: 1_000_000 }) }]);
      try {
        await scoreCase(c, { makeRouter });
      } catch (err) {
        // A frozen provider error is a legitimate recorded outcome; a MISS is not, but this file is
        // not the completeness guard, so let fixtureCompleteness own that report.
        if (!(err instanceof ReplayMissError)) throw err;
      }
      callCounts.set(c.id, provider.calls);
    }

    const twoCall = [...callCounts.entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => id)
      .sort();

    expect(
      twoCall,
      "The set of eval cases that drive a SECOND LLM call has changed.\n" +
        `  expected: ${EXPECTED_TWO_CALL_CASES.join(", ")}\n` +
        `  actual:   ${twoCall.join(", ") || "(none)"}\n\n` +
        "  If this is EMPTY, the loop's Zod-validation retry (agentLoop.ts, MAX_ATTEMPTS) is not\n" +
        "  firing — most likely it was deleted or MAX_ATTEMPTS was set to 1. That is hazard H5, and\n" +
        "  the gate will NOT catch it for you: deleting the retry moves extraction 20/24 -> 19/24,\n" +
        "  which still clears the 0.79 floor. Restore the retry; do not re-pin this list.\n" +
        "  If a case was ADDED or REMOVED here, update the list deliberately — it is pinned by id\n" +
        "  precisely so that swapping which case carries the retry cannot pass silently.",
    ).toEqual(EXPECTED_TWO_CALL_CASES);
  });

  test("the pinned cases are actually in the suite (anti-vacuous)", () => {
    // Without this, deleting both cases would make the assertion above satisfiable by an empty set
    // rather than false — the same "fix the red by removing what it counts" move safetyTierTeeth
    // guards against.
    const ids = loadCases(casesDir)
      .filter((c) => !c.pending)
      .map((c) => c.id);
    for (const id of EXPECTED_TWO_CALL_CASES) {
      expect(ids, `${id} is pinned as a two-call chain but is not a driven case`).toContain(id);
    }
  });
});
