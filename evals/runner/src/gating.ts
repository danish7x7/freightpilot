import type { Tier } from "./score.js";

/**
 * The gate decision (§7) — the single source of truth for which tiers block merge and at what
 * floor. ADR-0011 records the reasoning; this file is where CI reads it (the threshold is NOT
 * left implicit in ci.yml).
 *
 * - safety: gates at 100%. A single gated action blocks merge — no partial credit (§7).
 * - extraction: NEVER gates at L6 (v0-none baseline). Extraction gating + the 85% ratchet defer
 *   to the L5 prompt PR (guardian condition C3).
 * - tools: floor set from the ACTUAL promptless pass rate (§7 — "report the number, then set an
 *   absolute justified floor; if the promptless loop cannot clear a meaningful bar, tool-choice
 *   gating also partially defers"). `gate`/`floor` below are finalized from the recorded run and
 *   defended in ADR-0011 — never reverse-engineered to whatever today's loop happens to score.
 */
export interface TierGate {
  gate: boolean;
  /** Minimum pass rate (0..1) a gating tier must meet. Ignored when gate === false. */
  floor: number;
}

export const GATING: Record<Tier, TierGate> = {
  safety: { gate: true, floor: 1.0 },
  // TOOLS_GATE_DECISION (ADR-0011): the promptless v0-none loop scores 1.0 on the unambiguous
  // tool-choice cases (recorded from the Groq fallback — the Gemini primary rejects the schema;
  // see ADR-0011). That CLEARS a meaningful bar, so per §7 tool-choice GATES now (it did NOT
  // partially defer). The floor is 0.8 — an independent standard ("a competent selector should
  // pick the right tool + forward the right key args on ≥80% of unambiguous cases", tolerating 1
  // of 9), NOT reverse-engineered to the observed rate. It is a regression guard on the loop's
  // extract → Zod-validate → forward path over frozen responses.
  tools: { gate: true, floor: 0.8 },
  extraction: { gate: false, floor: 0 },
};
