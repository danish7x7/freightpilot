import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runEvals } from "../src/run.js";
import { tempDir, toolCallResponse } from "./helpers.js";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/agent.js";

/**
 * `captured_at` must describe the bytes, not the day someone ran a command.
 *
 * L5-C18 requires the scorecard to carry the CAPTURE date, and `captureMeta.ts` justifies the file
 * on the grounds that it is written BY the capture rather than asserted afterwards by a person.
 * That justification only holds if a run which captured nothing cannot write it.
 *
 * It very nearly did not hold. Record mode short-circuits on an existing fixture
 * (`replayProvider.ts`), so re-running `pnpm run record` over a COMPLETE set makes zero live calls,
 * refreshes no bytes, and — before this guard — still stamped today's date. The recordings README
 * documents that re-record path as an ordinary operator action, so this was not hypothetical: it is
 * how the field would have come to report fresh provenance for months-old fixtures, which is the
 * "CI green forever on stale bytes" hazard `gating.ts` names. Caught by code-reviewer on the branch
 * review, after the author had used exactly that path to produce the committed metadata.
 *
 * These tests drive the REAL capture path rather than deriving recording keys by hand, so they
 * cannot drift from how `scoreCase` actually keys a request.
 *
 * WHAT BREAKS THESE TESTS:
 *   - drop the `replayProvider.liveFetches > 0` condition in run.ts -> test 2 fails
 *   - stop counting fetches in ReplayProvider                       -> test 1 fails (never written)
 *   - write the metadata from replay mode                           -> test 3 fails
 */

const CASE_YAML = `id: extraction-meta-probe
tier: extraction
description: fixture for the capture-metadata freshness guard
input:
  message: hello
expect:
  kind: tool
  tool: search_rates
  args: {}
`;

/** A live provider that counts how many times it was actually asked for a response. */
class CountingLive implements LlmProvider {
  readonly name = "gemini";
  readonly model = "test-model";
  readonly supportsTools = true;
  calls = 0;
  async chat(_req: ChatRequest): Promise<ChatResponse> {
    this.calls++;
    return toolCallResponse("search_rates", {});
  }
}

function scaffold(name: string): { casesDir: string; recordingsDir: string; metaPath: string } {
  const root = tempDir(name);
  const casesDir = join(root, "cases");
  const recordingsDir = join(root, "recordings");
  mkdirSync(join(casesDir, "extraction"), { recursive: true });
  mkdirSync(recordingsDir, { recursive: true });
  writeFileSync(join(casesDir, "extraction", "extraction-meta-probe.yaml"), CASE_YAML);
  return { casesDir, recordingsDir, metaPath: recordingsDir + ".meta.json" };
}

const runOpts = (casesDir: string, recordingsDir: string, mode: "record" | "replay", inner?: LlmProvider) => ({
  casesDir,
  recordingsDir,
  mode,
  inner,
  enforceGate: false,
  log: () => {},
});

describe("capture metadata is written by a CAPTURE, not by any record-mode run", () => {
  test("a real capture stamps the provenance", async () => {
    const { casesDir, recordingsDir, metaPath } = scaffold("meta-fetch");
    const live = new CountingLive();
    await runEvals(runOpts(casesDir, recordingsDir, "record", live));

    expect(live.calls, "the fixture did not exist, so it had to be fetched").toBeGreaterThan(0);
    expect(existsSync(metaPath), "a real capture must stamp its provenance").toBe(true);
    expect(JSON.parse(readFileSync(metaPath, "utf8")).captured_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("a SECOND record run over the same fixtures fetches nothing and leaves the stamp alone", async () => {
    const { casesDir, recordingsDir, metaPath } = scaffold("meta-nofetch");

    // Pass 1: a genuine capture, through the real path, so the fixture key is whatever the loop
    // actually asks for rather than something this test computed.
    await runEvals(runOpts(casesDir, recordingsDir, "record", new CountingLive()));

    // Backdate the stamp to stand in for a fixture set captured long ago.
    const stale = {
      captured_at: "2020-01-01",
      prompt_version: "v-old",
      prompt_sha256: "0".repeat(64),
      served_models: ["ancient-model"],
    };
    writeFileSync(metaPath, JSON.stringify(stale, null, 2) + "\n");

    // Pass 2: the ordinary "re-record" an operator runs after a model change, which captures
    // nothing because every key already has a fixture.
    const second = new CountingLive();
    await runEvals(runOpts(casesDir, recordingsDir, "record", second));

    expect(second.calls, "every key already had a fixture, so nothing should have been fetched").toBe(0);
    expect(
      JSON.parse(readFileSync(metaPath, "utf8")),
      "a run that captured nothing refreshed the capture date. It now reports fresh provenance for " +
        "untouched bytes, which is the exact staleness this field exists to expose.",
    ).toEqual(stale);
  });

  test("replay mode never writes the stamp", async () => {
    const { casesDir, recordingsDir, metaPath } = scaffold("meta-replay");
    await runEvals(runOpts(casesDir, recordingsDir, "record", new CountingLive()));
    rmSync(metaPath);

    await runEvals(runOpts(casesDir, recordingsDir, "replay"));
    expect(existsSync(metaPath), "replay must never claim to have captured anything").toBe(false);
  });
});
