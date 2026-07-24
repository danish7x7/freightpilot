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

describe("scorecard.ts — byte-deterministic (§5)", () => {
  test("identical input → byte-identical output (determinism regression)", () => {
    const a = serializeScorecard(buildScorecard(RESULTS));
    const b = serializeScorecard(buildScorecard([...RESULTS].reverse()));
    expect(a).toBe(b); // order-independent + stable key ordering
  });

  test("body carries no timestamp / latency / token fields", () => {
    const s = serializeScorecard(buildScorecard(RESULTS));
    expect(s).not.toMatch(/timestamp|latency|latencyMs|inputTokens|outputTokens|"date"/i);
  });

  test("stamps prompt_version and the gating map", () => {
    const card = buildScorecard(RESULTS);
    expect(card.prompt_version).toBe("v0-none");
    expect(card.gating).toEqual({ extraction: false, safety: true, tools: true });
    expect(card.tiers.tools.pass_rate).toBe(0.5); // 1 pass / 2 scored (pending excluded)
    expect(card.pending.map((p) => p.id)).toEqual(["p1"]);
  });
});
