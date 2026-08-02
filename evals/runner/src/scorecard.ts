import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { SYSTEM_PROMPT } from "./agent.js";
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
  /**
   * The distinct models that actually ANSWERED, sorted (L5-C18's "served model").
   *
   * `prompt_version` labels the prompt; this labels the other half of what produced these numbers.
   * Stamping the configured alias here would satisfy the words and defeat the purpose: it records
   * what was asked for, not what replied, and `gemini-flash-latest` compares equal to itself across
   * a rotation that changed every byte underneath it.
   *
   * A SET, not a scalar: the capture spans more than one day, so a mid-capture rotation is possible
   * and must be visible rather than averaged into whichever value happened to be picked. Two
   * entries here means the fixture set is not homogeneous, which is a finding.
   *
   * Empty until the v1 capture lands, since no v0-none recording carries the field.
   */
  served_models: string[];
  /**
   * Date the capture that produced these fixtures ran (L5-C18), read from the committed capture
   * metadata. NOT the date this scorecard was generated: replay runs long after the bytes were
   * recorded, and stamping "now" would answer the wrong question in the most reassuring way.
   * Null for a fixture set predating the metadata file.
   */
  captured_at: string | null;
  /**
   * sha256 of the trimmed prompt text this run put on the wire (reviewer addition R1).
   *
   * `prompt_version` is a LABEL a human types. This is the bytes. ADR-0011 finding (a) was a label
   * decoupled from what actually ran, so pairing the two here makes the coupling machine-checked:
   * `scorecardPromptDigest.test.ts` asserts this equals the digest of the committed
   * `prompts/v1_system.md` read from disk. A prompt file edited without a version bump changes
   * this value and fails that test.
   */
  prompt_sha256: string;
  gating: Record<Tier, boolean>;
  thresholds: Record<Tier, number | null>;
  tiers: Record<Tier, TierSummary>;
  pending: { id: string; tier: Tier; reason: string }[];
}

/**
 * `servedModels` is a REQUIRED parameter, not an optional one with a default.
 *
 * A default would let a caller omit it and produce a scorecard that silently claims an empty set,
 * which is indistinguishable from a capture that genuinely recorded none. Making it required turns
 * that omission into a compile error at every call site.
 */
export function buildScorecard(
  results: ScoreResult[],
  servedModels: string[],
  capturedAt: string | null,
): Scorecard {
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
    captured_at: capturedAt,
    // Hashed from the production constant this run actually composed with, not from a file read
    // here — a digest of something other than what went on the wire would be decorative.
    prompt_sha256: createHash("sha256").update(SYSTEM_PROMPT ?? "").digest("hex"),
    // Sorted and de-duplicated HERE rather than trusting the caller, so byte-determinism is a
    // property of buildScorecard itself and not of whoever happens to call it.
    served_models: [...new Set(servedModels)].sort(),
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
