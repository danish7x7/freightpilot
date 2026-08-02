import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import {
  LlmRouter,
  SYSTEM_PROMPT,
  TokenBucket,
  createProvider,
  loadLlmConfig,
  type LlmProvider,
  type LlmRouter as LlmRouterType,
} from "./agent.js";
import { loadCases } from "./loadCases.js";
import { readCaptureMeta, writeCaptureMeta } from "./captureMeta.js";
import { collectServedModels, ReplayProvider, type ReplayMode } from "./replayProvider.js";
import { scoreCase, type ScoreDeps, type ScoreResult, type Tier } from "./score.js";
import { buildScorecard, writeScorecard, type Scorecard } from "./scorecard.js";
import { GATING } from "./gating.js";
import type { TierGate } from "./gating.js";
import { PROMPT_VERSION } from "./promptVersion.js";

/**
 * The eval entrypoint (§1, §7). load → drive the REAL loop over the ReplayProvider → score →
 * write the deterministic scorecard → gate. Replay mode (default) makes ZERO API calls; a replay
 * miss is a hard error. Record mode (EVAL_RECORD=1, manual) captures the throwaway v0-none set.
 *
 * `runEvals` is the library form so the runner's own gate-mechanism test (§6) can drive it against
 * a temp fixture dir and assert the exit code. The CLI wrapper at the bottom wires the real dirs.
 */
const TIERS: Tier[] = ["extraction", "safety", "tools"];

export interface RunOptions {
  casesDir: string;
  recordingsDir: string;
  resultsDir?: string;
  mode: ReplayMode;
  /** Enforce the gate (non-zero exit below a gating floor). Defaults to true in replay mode. */
  enforceGate?: boolean;
  /** Write the scorecard to resultsDir. Defaults to true when resultsDir is set. */
  writeScorecardFile?: boolean;
  /** Gate config override (the gate-mechanism test injects its own). Defaults to GATING. */
  gating?: Record<Tier, TierGate>;
  /** Date stamp for the scorecard FILENAME only (never the body). Defaults to today (UTC). */
  date?: string;
  log?: (line: string) => void;
}

export interface RunResult {
  exitCode: number;
  scorecard: Scorecard;
  results: ScoreResult[];
  scorecardPath?: string;
}

export async function runEvals(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const gating = opts.gating ?? GATING;
  const enforceGate = opts.enforceGate ?? opts.mode === "replay";

  const cases = loadCases(opts.casesDir);

  // One shared ReplayProvider + bucket composed inside the REAL LlmRouter (guardian Q3). In record
  // mode the bucket paces against the real free-tier rpm; in replay it never blocks (calls are I/O
  // reads). Shared across cases so record mode actually paces the whole capture.
  const router = buildEvalRouter(opts.mode, opts.recordingsDir);
  const deps: ScoreDeps = { makeRouter: () => router };

  // Record mode ONLY: space live capture between cases so a burst of sequential Gemini calls
  // (multi-turn cases fire several per case) stays under the free-tier per-minute quota — the
  // record TokenBucket already paces calls WITHIN a case (EVAL_RECORD_RPM); this adds the
  // between-case spacing. Env-tunable via EVAL_RECORD_DELAY_MS (default 5000). In replay/CI
  // (mode !== "record") it is a STRICT no-op: zero added latency, and nothing about which cases
  // run, what gets recorded, the recording key, or the scorecard changes.
  const interCaseDelayMs = opts.mode === "record" ? recordDelayMs() : 0;

  const results: ScoreResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    if (i > 0 && interCaseDelayMs > 0) await sleep(interCaseDelayMs);
    results.push(await scoreCase(cases[i], deps));
  }

  // Read AFTER the loop so record mode's stamp includes what it just captured. Note it is the whole
  // committed directory, not this run's consumption set: see collectServedModels on why those two
  // are equivalent in replay/CI and can diverge during a capture.
  const servedModels = collectServedModels(opts.recordingsDir);
  const metaPath = opts.recordingsDir + ".meta.json";
  const runDate = opts.date ?? new Date().toISOString().slice(0, 10);

  // Record mode STAMPS the capture date; replay only reads it. L5-C18 wants the date the BYTES were
  // produced, and only the capture knows that — at replay time "now" is whenever CI ran.
  if (opts.mode === "record") {
    writeCaptureMeta(metaPath, {
      captured_at: runDate,
      prompt_version: PROMPT_VERSION,
      prompt_sha256: createHash("sha256").update(SYSTEM_PROMPT ?? "").digest("hex"),
      served_models: servedModels,
    });
  }
  const scorecard = buildScorecard(results, servedModels, readCaptureMeta(metaPath)?.captured_at ?? null);
  printReport(scorecard, results, opts.mode, gating, log);

  let scorecardPath: string | undefined;
  const shouldWrite = opts.writeScorecardFile ?? Boolean(opts.resultsDir);
  if (shouldWrite && opts.resultsDir) {
    const date = runDate;
    scorecardPath = writeScorecard(opts.resultsDir, scorecard, date);
    log(`\nscorecard → ${scorecardPath}`);
  }

  // Gate: a gating tier below its floor fails the run. Record mode never gates (it is capturing).
  const failedTiers = enforceGate ? gatedFailures(scorecard, gating) : [];
  const exitCode = failedTiers.length > 0 ? 1 : 0;
  if (failedTiers.length > 0) {
    log(`\nGATE FAILED — gating tier(s) below floor: ${failedTiers.join(", ")}`);
  } else if (enforceGate) {
    log(`\nGATE PASSED — all gating tiers at/above floor.`);
  }

  return { exitCode, scorecard, results, scorecardPath };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Inter-case record pacing (ms). EVAL_RECORD_DELAY_MS overrides; default 5000. Only consulted
 * on the record path (see runEvals) — never affects replay/CI. A negative/NaN value falls back
 * to the default so a typo can't disable pacing. */
function recordDelayMs(): number {
  const raw = process.env.EVAL_RECORD_DELAY_MS?.trim();
  if (raw === undefined || raw === "") return 5000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 5000;
}

function gatedFailures(card: Scorecard, gating: Record<Tier, TierGate>): string[] {
  const failed: string[] = [];
  for (const tier of TIERS) {
    const g = gating[tier];
    if (!g.gate) continue;
    if (card.tiers[tier].pass_rate < g.floor) {
      failed.push(`${tier} (${card.tiers[tier].pass_rate} < ${g.floor})`);
    }
  }
  return failed;
}

function printReport(
  card: Scorecard,
  results: ScoreResult[],
  mode: ReplayMode,
  gating: Record<Tier, TierGate>,
  log: (l: string) => void,
): void {
  log(`FreightPilot evals — prompt_version=${PROMPT_VERSION} mode=${mode}`);
  for (const tier of TIERS) {
    const t = card.tiers[tier];
    const g = gating[tier];
    const gateStr = g.gate ? `GATING floor=${g.floor}` : "non-gating";
    log(`  ${tier.padEnd(11)} ${t.passed}/${t.total}  pass_rate=${t.pass_rate}  [${gateStr}]`);
    for (const c of t.cases.filter((x) => x.status === "fail")) {
      log(`      FAIL ${c.id}: ${c.detail}`);
    }
  }
  // §7: report the actual promptless tool-choice number prominently, whatever the gate decides.
  log(`  >> promptless tool-choice pass_rate = ${card.tiers.tools.pass_rate} (${PROMPT_VERSION} baseline)`);
  if (card.pending.length > 0) {
    // "declared", not "recorded": a pending case is never driven, so it has no fixture and never
    // had one. Saying "recorded" inside the runner's own honesty report would be a false claim.
    log(`  pending (declared but not scored — visible gaps):`);
    for (const p of card.pending) log(`      PENDING ${p.id}: ${p.reason}`);
  }
}

function buildEvalRouter(mode: ReplayMode, recordingsDir: string): LlmRouterType {
  if (mode === "record") {
    const config = loadLlmConfig();
    // Which chain entry to capture from. Captures from the PRIMARY (chain[0], Gemini per ADR-0007)
    // by default — that is the correct provenance for a committed baseline, and the current fixture
    // set is 30/30 Gemini. EVAL_RECORD_PROVIDER selects a different entry BY NAME; it is a
    // DELIBERATE OVERRIDE for one-off comparison captures only, never the normal path. Reaching for
    // it to dodge a primary-side error is how a baseline goes silently green on the fallback: that
    // is exactly what ADR-0011 finding (a) was (`exclusiveMinimum` 400'd Gemini non-retryably, so
    // every fixture came from Groq and the primary's rejection hid). Finding (a) is FIXED — if the
    // primary 400s again, fix the request, do not re-point the capture.
    const want = process.env.EVAL_RECORD_PROVIDER;
    const picked = (want && config.chain.find((c) => c.name === want)) || config.chain[0];
    const inner: LlmProvider = createProvider(picked, config.timeoutMs);
    const provider = new ReplayProvider({ mode, recordingsDir, inner });
    // Pace record mode GENTLY from the very first call (capacity=1, not a full-bucket burst) so a
    // bulk capture does not trip the free-tier limiter. EVAL_RECORD_RPM tunes it (default 12/min).
    const rpm = Number(process.env.EVAL_RECORD_RPM ?? 12);
    return new LlmRouter([{ provider, bucket: new TokenBucket({ rpm, capacity: 1 }) }]);
  }
  const provider = new ReplayProvider({ mode, recordingsDir });
  // Replay never hits the network; a large rpm means the bucket never paces.
  return new LlmRouter([{ provider, bucket: new TokenBucket({ rpm: 1_000_000 }) }]);
}

// --- CLI ----------------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..", "..", ".."); // evals/runner/src -> repo root
  const mode: ReplayMode = process.env.EVAL_RECORD === "1" ? "record" : "replay";
  runEvals({
    casesDir: join(repoRoot, "evals", "cases"),
    recordingsDir: join(here, "recordings"),
    resultsDir: join(repoRoot, "evals", "results"),
    mode,
  })
    .then((r) => process.exit(r.exitCode))
    .catch((err) => {
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
      process.exit(2);
    });
}
