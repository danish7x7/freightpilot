/**
 * The L5-C8 step 5 pre-registration, in code.
 *
 * These numbers were written down BEFORE the v1 capture existed, in
 * `docs/decisions/0012-l5-system-prompt-extraction-gating-methodology.md` §2, and condition L5-C11
 * forbids adjusting the floor downward after seeing what v1 scores. They live here rather than only
 * in the ADR's prose so that the case set, the gate, and the ADR cannot drift apart silently:
 * `test/caseMix.test.ts` asserts the shipped cases still match them, and at L5-C8 step 7 the
 * extraction entry in `gating.ts` is set FROM `PREREGISTERED_EXTRACTION_FLOOR` rather than from a
 * second literal.
 *
 * Editing any value in this file after the capture is the exact move L5-C11 prohibits. If a run
 * misses the floor there are two permitted responses, both recorded in ADR-0012 §2.6: re-cut the
 * prompt and re-capture, or ship extraction non-gating with the reason recorded. Neither one edits
 * this file.
 */

/** Driven (non-pending) extraction cases the floor arithmetic runs against. ADR-0012 §2.1. */
export const PREREGISTERED_EXTRACTION_M = 24;

/**
 * Driven extraction cases classified HARD, per the criterion in ADR-0012 §2.2: the correct answer
 * requires the agent to transform or to withhold. The remaining `M - HARD` are EASY.
 */
export const PREREGISTERED_EXTRACTION_HARD = 11;

/**
 * WHICH cases are hard, not merely how many.
 *
 * The floor's ARITHMETIC needs only the count, but its JUSTIFICATION (ADR-0012 §2.5) is built on
 * what these particular cases require: each is paired in §2.2 with the §7 hard class it covers, and
 * the coverage argument for the two classes L5-C12 dropped depends on specific ids being in this
 * list. So a swap that keeps the count at 11 preserves the number while silently invalidating the
 * reasoning behind it, and nothing would notice. code-reviewer demonstrated exactly that: moving
 * `hard` from `extraction-city-to-locode` to `extraction-ocean-osaka-la` left all 90 runner tests
 * green.
 *
 * Kept sorted so a diff of this list reads as an add/remove rather than a reshuffle.
 */
export const PREREGISTERED_HARD_CASE_IDS: readonly string[] = [
  "extraction-absurd-weight-at-quote",
  "extraction-city-to-locode",
  "extraction-heavy-but-valid-25000kg",
  "extraction-imperial-weight",
  "extraction-missing-destination-clarify",
  "extraction-missing-origin-synonym-probe",
  "extraction-multi-leg-red-herring",
  "extraction-obscure-city-asks",
  "extraction-relative-date-no-reference",
  "extraction-relative-date-with-reference",
  "extraction-volumetric-vs-actual",
];

/**
 * Failures tolerated of `M`. ADR-0012 §2.4 registers the floor as "tolerate at most 5 of 24":
 * zero tolerance on the 13 easy cases, plus a bare majority (6 of 11) of the hard ones.
 */
export const PREREGISTERED_EXTRACTION_MAX_FAILURES = 5;

/**
 * The floor as `gating.ts` will encode it. 19 passes of 24 scores 0.7917 and clears; 18 scores
 * 0.75 and fails. Written as 0.79 rather than 0.7917 so the encoded threshold cannot be mistaken
 * for a measurement.
 */
export const PREREGISTERED_EXTRACTION_FLOOR = 0.79;
