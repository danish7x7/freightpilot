import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadCases } from "../src/loadCases.js";
import {
  PREREGISTERED_EXTRACTION_FLOOR,
  PREREGISTERED_EXTRACTION_HARD,
  PREREGISTERED_EXTRACTION_M,
  PREREGISTERED_HARD_CASE_IDS,
  PREREGISTERED_EXTRACTION_MAX_FAILURES,
} from "../src/preregistration.js";

/**
 * The case set must still be the one the extraction floor was pre-registered against
 * (condition L5-C11, ADR-0012 §2).
 *
 * The floor is not a free-standing number. It is derived from two counts: M driven extraction
 * cases and how many of them are HARD. L5-C11 requires the floor to sit strictly above the rate the
 * suite would score with every hard case failing and every easy case passing, and that rate is
 * `easy / M`. Change either count and the floor's justification silently stops describing the
 * suite, in a document nobody re-derives by hand.
 *
 * Until this file existed the split lived only in ADR-0012's prose, so it was unauditable by any
 * mechanical means: `recordingKey` does not hash case metadata, so stamping, unstamping, adding or
 * retiring a case leaves no fixture churn at all. That is hazard H7's surface, one level up from
 * the `expect` blocks it was written about. The mitigation is the same shape: pin the number and
 * make a reviewer's check a test run rather than a re-derivation.
 *
 * WHAT MAKES THESE TESTS FAIL (they are guards, not decoration):
 *   - flip one case's `hard` flag either way          -> the hard/easy count assertions fail
 *   - add or retire a driven extraction case          -> the M assertion fails
 *   - edit a floor constant so the tolerance and the
 *     encoded threshold disagree                      -> the encoding assertions fail
 *   - lower the floor to at or below the all-hard-fail
 *     bound (the L5-C11 violation this exists to stop) -> the bound assertion fails
 */

const casesDir = fileURLToPath(new URL("../../cases", import.meta.url));

/** `pass_rate` as the scorecard computes it (scorecard.ts:105), so these compare like for like. */
function rate(passed: number, total: number): number {
  return Number((passed / total).toFixed(4));
}

describe("extraction case mix matches the pre-registration", () => {
  const driven = loadCases(casesDir).filter((c) => c.tier === "extraction" && !c.pending);
  const hard = driven.filter((c) => c.hard === true);
  const easy = driven.filter((c) => c.hard !== true);

  test("driven extraction case count is M", () => {
    expect(
      driven.length,
      `M moved. The floor in ADR-0012 §2.4 is registered as "tolerate at most ` +
        `${PREREGISTERED_EXTRACTION_MAX_FAILURES} of ${PREREGISTERED_EXTRACTION_M}" and its ` +
        `arithmetic runs on M=${PREREGISTERED_EXTRACTION_M}. Adding or retiring a driven ` +
        `extraction case changes what the floor means. Per L5-C11 the response is to re-derive and ` +
        `re-register in the ADR, never to edit the constant so the test passes again.`,
    ).toBe(PREREGISTERED_EXTRACTION_M);
  });

  test("hard-case count matches ADR-0012 §2.2, and every hard case is a driven extraction case", () => {
    expect(
      hard.map((c) => c.id).sort(),
      `the hard/easy split moved: ${hard.length} hard, ${easy.length} easy, ` +
        `pre-registered ${PREREGISTERED_EXTRACTION_HARD} hard. ADR-0012 §2.2 lists the ` +
        `classification and the criterion it was applied by. A case reclassified toward HARD ` +
        `LOWERS the all-hard-fail bound and is the lenient direction, so it needs the same ` +
        `disclosure the 10-to-11 move got.`,
    ).toHaveLength(PREREGISTERED_EXTRACTION_HARD);
    expect(easy).toHaveLength(PREREGISTERED_EXTRACTION_M - PREREGISTERED_EXTRACTION_HARD);
  });

  test("the hard cases are the exact set ADR-0012 §2.2 lists, not merely 11 of them", () => {
    // The count alone does not defend the floor. §2.5 argues it from what these SPECIFIC cases
    // require, and §2.2 pairs each with the §7 class it covers, so a swap that preserves the count
    // keeps the number while gutting its justification. Demonstrated by code-reviewer: moving the
    // flag between two cases left every other test green.
    expect(
      hard.map((c) => c.id).sort(),
      "the hard SET changed even if the count did not. ADR-0012 §2.2 names these ids and pairs " +
        "each with a §7 hard class; changing membership changes what the floor means.",
    ).toEqual([...PREREGISTERED_HARD_CASE_IDS].sort());
  });

  test("the floor encodes the pre-registered tolerance exactly", () => {
    const worstPassing = PREREGISTERED_EXTRACTION_M - PREREGISTERED_EXTRACTION_MAX_FAILURES;
    // `run.ts:122` fails a tier when pass_rate < floor, so "at most N failures" means the floor
    // must admit M-N passes and reject one fewer. Both directions, or the constant is decorative.
    expect(rate(worstPassing, PREREGISTERED_EXTRACTION_M)).toBeGreaterThanOrEqual(PREREGISTERED_EXTRACTION_FLOOR);
    expect(rate(worstPassing - 1, PREREGISTERED_EXTRACTION_M)).toBeLessThan(PREREGISTERED_EXTRACTION_FLOOR);
  });

  test("the floor is strictly above the all-hard-fail bound (L5-C11)", () => {
    const allHardFail = rate(easy.length, PREREGISTERED_EXTRACTION_M);
    expect(
      PREREGISTERED_EXTRACTION_FLOOR,
      `a floor at or below ${allHardFail} is cleared by a prompt that handles no hard class at ` +
        `all, which is exactly what L5-C11 forbids.`,
    ).toBeGreaterThan(allHardFail);
  });
});
