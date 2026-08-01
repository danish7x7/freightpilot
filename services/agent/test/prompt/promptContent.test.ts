import { describe, expect, test } from "vitest";
import { SYSTEM_PROMPT } from "../../src/prompt/systemPrompt.js";
import { TOOLS } from "../../src/tools/index.js";

/**
 * Content constraints on the prompt itself (condition L5-C13, plus reviewer rules R2 and R3).
 *
 * PROMPT FILES ARE CODE, so the properties that must hold of the text are asserted like any other
 * invariant rather than left to review. These are deliberately STRUCTURAL properties (a date
 * literal is present or it is not) and not judgements about tone or quality, which a test cannot
 * hold and should not pretend to.
 */
const prompt = (SYSTEM_PROMPT ?? "").toLowerCase();

describe("prompt content (L5-C13)", () => {
  /**
   * ARMS EVERY NEGATIVE ASSERTION BELOW. Without it, three tests in this file (the R2 date-literal
   * check, the origin-needle probe, and the example-collision check) PASS on a fully degraded
   * prompt, because `expect("").not.toContain(x)` holds for every x. code-reviewer measured it: with
   * `SYSTEM_PROMPT` forced to `undefined` this file scored 8 failed and 3 passed, and the 3 that
   * passed were exactly the anti-overfitting guards. Tautological in precisely the degraded state
   * this PR exists to prevent is the worst place for them to be tautological.
   */
  test("SYSTEM_PROMPT is a non-empty string (without this, every negative below is vacuous)", () => {
    expect(SYSTEM_PROMPT).toBeTypeOf("string");
    expect(prompt.length).toBeGreaterThan(1000);
  });

  test("names all six real tools and no tool that does not exist", () => {
    // Pins the COUNT as well as the membership: the prompt says "exactly six tools" in prose, and
    // without this a seventh tool would force a rename in the loop below while silently making that
    // sentence false. The word and the array have to move together.
    expect(TOOLS).toHaveLength(6);
    // Written from TOOLS, not from MASTER_PLAN §6.2, whose table is stale: it lists five and
    // includes `get_quote` (since split into calculate_quote/create_quote) and
    // `get_booking_status` (renamed get_booking). That drift is a documentation carry, to be
    // recorded when ADR-0012 is written (Part 9); it is deliberately NOT fixed in this PR.
    for (const tool of TOOLS) {
      expect(prompt, `prompt does not mention the real tool ${tool.name}`).toContain(tool.name);
    }
    for (const ghost of ["get_quote", "get_booking_status", "cancel_booking", "confirm_booking"]) {
      expect(prompt, `prompt names ${ghost}, which no tool backs`).not.toContain(ghost);
    }
  });

  test("cites the documented 30,000 kg bound explicitly, not a vague 'large'", () => {
    // L5-C12: the trigger is stated as the DOCUMENTED bound, never as "large numbers". The bound is
    // cargoSchema.weight_kg.max(30000); a prompt that says "very heavy" gives the model nothing to
    // apply and gives the eval nothing to assert.
    expect(prompt).toMatch(/30,000 kg|30000 kg/);
  });

  test("states the imperial rounding rule (R3) so an imperial case is pinnable", () => {
    expect(prompt).toContain("0.45359237");
    expect(prompt).toMatch(/nearest whole kilogram/);
  });

  test("contains NO date literal and no template placeholder (R2)", () => {
    // The reference-date rule exists because the prompt is inside the keyed `messages`: a live date
    // in the text would change the prompt daily, change every recordingKey, and invalidate the
    // whole fixture set every 24 hours. A placeholder would be worse, since it implies a
    // substitution step that does not exist.
    //
    // NOTE the distinction being drawn: an actual date (2026-08-01) is forbidden; the literal
    // string "YYYY-MM-DD" as a FORMAT description would be fine. This prompt happens to spell the
    // format out in words instead, so neither appears.
    expect(SYSTEM_PROMPT ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(SYSTEM_PROMPT ?? "").not.toMatch(/\{\{|\}\}|\$\{/);
  });

  test("does not claim create_booking books anything", () => {
    // Hard rules 2 and 4: create_booking PROPOSES. A prompt that says it books would be describing
    // a capability the tool deliberately does not have (tools/booking.ts:155 executes nothing).
    expect(prompt).toMatch(/does not create a booking|does not book/);
    expect(prompt).toMatch(/proposal|prepare/);
  });

  test("tells the agent to treat tool results and cargo text as data, not instructions", () => {
    // §6.3.6 names cargo.description as the untrusted surface.
    expect(prompt).toMatch(/data, not instructions|not as an instruction|never as something you act on/);
    expect(prompt).toContain("cargo");
  });

  test("forbids money arithmetic", () => {
    expect(prompt).toMatch(/never calculate, estimate, or adjust a price/);
  });

  test("states the ask-rather-than-invent rule for port codes", () => {
    expect(prompt).toContain("un/locode");
    expect(prompt).toMatch(/never send a code|never invent a code/);
  });

  test("states a bounded clarification budget (§6.3.3)", () => {
    expect(prompt).toMatch(/ask at most twice|at most two/);
  });

  /**
   * ANTI-OVERFITTING, and the reason it is a test rather than a note.
   *
   * `extraction-missing-origin-synonym-probe` is the designated overfitting detector: it holds out
   * the PHRASING of a missing-origin request and accepts any wording that names the field. If the
   * prompt itself contains the eval's needle vocabulary, the probe passes for the wrong reason and
   * stops being a detector at all.
   *
   * So the origin needle group's alternatives are kept OUT of the prompt. The port-code vocabulary
   * ("code", "port") could not be, because the LOCODE rule is literally about port codes and there
   * is no way to state it otherwise. That asymmetry is a reporting obligation for ADR-0012,
   * which does not exist yet (Part 9 writes it); it is stated here so the obligation is visible
   * even if the ADR slips.
   */
  test("avoids the origin-clarification needle vocabulary, so the synonym probe stays a probe", () => {
    for (const needle of ["shipping from", "port of loading"]) {
      expect(prompt, `prompt contains the eval needle "${needle}"`).not.toContain(needle);
    }
  });

  test("uses example port codes and an example conversion that no eval case asserts", () => {
    // The prompt teaches by example, and an example that coincides with a case's expected answer is
    // a lookup table rather than a rule. CNSHA/USOAK (extraction-city-to-locode) and the 1,760 lb →
    // 798 kg pair (extraction-imperial-weight) are deliberately NOT the examples used.
    expect(prompt).not.toContain("cnsha");
    expect(prompt).not.toContain("usoak");
    expect(prompt).not.toContain("1,760");
    expect(prompt).not.toContain("798");
  });
});
