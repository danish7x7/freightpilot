import { writeFileSync } from "node:fs";
import { canonicalJson } from "./recordingKey.js";
import { GATING } from "./gating.js";
import { PROMPT_VERSION } from "./promptVersion.js";
import type { ScoreResult, Tier } from "./score.js";

/**
 * The committed scorecard (§5) — byte-deterministic so `git diff` shows real capability change,
 * not noise. Determinism rules: keys sorted (canonicalJson), pass rates fixed to 4 decimals,
 * NO timestamp in the body (only in the filename), NO latency/token fields. The body is
 * pass/fail per case + per-tier rates + prompt_version + the gating map.
 */
const TIERS: Tier[] = ["extraction", "safety", "tools"];

export interface TierSummary {
  gating: boolean;
  floor: number;
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  cases: { id: string; status: string; detail: string }[];
}

export interface Scorecard {
  prompt_version: string;
  gating: Record<Tier, boolean>;
  thresholds: Record<Tier, number | null>;
  tiers: Record<Tier, TierSummary>;
  pending: { id: string; tier: Tier; reason: string }[];
}

export function buildScorecard(results: ScoreResult[]): Scorecard {
  const tiers = {} as Record<Tier, TierSummary>;
  for (const tier of TIERS) {
    const inTier = results.filter((r) => r.tier === tier && r.status !== "pending");
    const passed = inTier.filter((r) => r.status === "pass").length;
    const total = inTier.length;
    tiers[tier] = {
      gating: GATING[tier].gate,
      floor: GATING[tier].floor,
      total,
      passed,
      failed: total - passed,
      pass_rate: rate(passed, total),
      cases: inTier
        .map((r) => ({ id: r.id, status: r.status, detail: r.detail }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  return {
    prompt_version: PROMPT_VERSION,
    gating: { extraction: GATING.extraction.gate, safety: GATING.safety.gate, tools: GATING.tools.gate },
    thresholds: {
      extraction: GATING.extraction.gate ? GATING.extraction.floor : null,
      safety: GATING.safety.gate ? GATING.safety.floor : null,
      tools: GATING.tools.gate ? GATING.tools.floor : null,
    },
    tiers,
    pending: results
      .filter((r) => r.status === "pending")
      .map((r) => ({ id: r.id, tier: r.tier, reason: r.detail }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Serialize deterministically (sorted keys, trailing newline). */
export function serializeScorecard(card: Scorecard): string {
  return JSON.stringify(JSON.parse(canonicalJson(card)), null, 2) + "\n";
}

export function writeScorecard(resultsDir: string, card: Scorecard, date: string): string {
  const file = `${resultsDir}/${date}_${card.prompt_version}.json`;
  writeFileSync(file, serializeScorecard(card));
  return file;
}

/** Pass rate rounded to 4 decimals (fixed formatting → byte-stable across identical inputs). */
function rate(passed: number, total: number): number {
  if (total === 0) return 0;
  return Number((passed / total).toFixed(4));
}
