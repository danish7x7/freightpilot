import { describe, expect, test } from "vitest";
import { buildScorecard, serializeScorecard } from "../src/scorecard.js";
import type { ScoreResult } from "../src/score.js";

const RESULTS: ScoreResult[] = [
  { id: "b-case", tier: "tools", status: "pass", detail: "ok" },
  { id: "a-case", tier: "tools", status: "fail", detail: "nope" },
  { id: "s1", tier: "safety", status: "pass", detail: "safe" },
  { id: "e1", tier: "extraction", status: "pass", detail: "ok" },
  { id: "p1", tier: "tools", status: "pending", detail: "loop can't express two calls" },
];

const SERVED = ["gemini-2.5-flash-preview-09-2025"];

describe("scorecard.ts — byte-deterministic (§5)", () => {
  test("identical input → byte-identical output (determinism regression)", () => {
    const a = serializeScorecard(buildScorecard(RESULTS, SERVED, null));
    const b = serializeScorecard(buildScorecard([...RESULTS].reverse(), SERVED, null));
    expect(a).toBe(b); // order-independent + stable key ordering
  });

  test("served_models is sorted and de-duplicated regardless of caller order", () => {
    // Determinism has to hold for this field too, and it must hold INSIDE buildScorecard rather
    // than relying on collectServedModels having already sorted: two callers, one guarantee.
    const a = serializeScorecard(buildScorecard(RESULTS, ["v-two", "v-one", "v-two"], null));
    const b = serializeScorecard(buildScorecard(RESULTS, ["v-one", "v-two"], null));
    expect(a).toBe(b);
    expect(buildScorecard(RESULTS, ["v-two", "v-one", "v-two"], null).served_models).toEqual(["v-one", "v-two"]);
  });

  test("body carries no timestamp / latency / token fields", () => {
    const s = serializeScorecard(buildScorecard(RESULTS, SERVED, null));
    expect(s).not.toMatch(/timestamp|latency|latencyMs|inputTokens|outputTokens|"date"/i);
  });

  test("stamps prompt_version, served_models and the gating map", () => {
    const card = buildScorecard(RESULTS, SERVED, null);
    // L5-C18: the scorecard records what ANSWERED, not only what was asked for.
    expect(card.served_models).toEqual(SERVED);
    // Pinned as a LITERAL rather than compared to the imported constant, which would be
    // tautological. The cost is that every version bump edits this line; that cost is the point,
    // since a bump is exactly the moment someone should be forced to look at the scorecard shape.
    expect(card.prompt_version).toBe("v1");
    // All three tiers gate as of L5-C8 step 7 (ADR-0012): extraction was registered at the
    // pre-registered floor of 0.79 once the v1 capture landed. Pinned as a literal for the same
    // reason prompt_version is: flipping a tier's gating status should force someone to edit this
    // line and notice.
    expect(card.gating).toEqual({ extraction: true, safety: true, tools: true });
    expect(card.tiers.tools.pass_rate).toBe(0.5); // 1 pass / 2 scored (pending excluded)
    expect(card.pending.map((p) => p.id)).toEqual(["p1"]);
  });
});
