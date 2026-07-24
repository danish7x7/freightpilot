import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LlmRouter,
  TokenBucket,
  createProvider,
  loadLlmConfig,
  type LlmProvider,
  type LlmRouter as LlmRouterType,
} from "./agent.js";
import { loadCases } from "./loadCases.js";
import { ReplayProvider, type ReplayMode } from "./replayProvider.js";
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

  const results: ScoreResult[] = [];
  for (const c of cases) {
    results.push(await scoreCase(c, deps));
  }

  const scorecard = buildScorecard(results);
  printReport(scorecard, results, opts.mode, gating, log);

  let scorecardPath: string | undefined;
  const shouldWrite = opts.writeScorecardFile ?? Boolean(opts.resultsDir);
  if (shouldWrite && opts.resultsDir) {
    const date = opts.date ?? new Date().toISOString().slice(0, 10);
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
    log(`  pending (recorded but not scored — visible gaps):`);
    for (const p of card.pending) log(`      PENDING ${p.id}: ${p.reason}`);
  }
}

function buildEvalRouter(mode: ReplayMode, recordingsDir: string): LlmRouterType {
  if (mode === "record") {
    const config = loadLlmConfig();
    // Which chain entry to capture from. Defaults to the primary; EVAL_RECORD_PROVIDER selects a
    // specific one BY NAME. This override exists because the recordings are provider-agnostic (the
    // key excludes provider — §3) AND because the primary (Gemini) currently rejects the shipment
    // tool schema: shipmentJsonSchema uses `exclusiveMinimum`, which Gemini's function-declaration
    // dialect does not accept (400, non-retryable → no fallback). That is a LATENT PRODUCTION gap,
    // flagged for the L5/debugger follow-up (see ADR-0011) — NOT fixed here (harness makes zero
    // production changes). Until it is fixed, capture the v0-none baseline from the OpenAI-compatible
    // fallback (EVAL_RECORD_PROVIDER=groq).
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
