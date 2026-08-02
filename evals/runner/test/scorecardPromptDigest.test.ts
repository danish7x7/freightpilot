import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { buildScorecard } from "../src/scorecard.js";

/**
 * R1: the scorecard's prompt DIGEST must match the committed prompt FILE.
 *
 * `prompt_version` is a label a person types. ADR-0011 finding (a) was a label decoupled from the
 * bytes that actually ran, and this PR exists largely to close that class. Stamping a digest beside
 * the label only helps if something checks the two describe the same thing, otherwise it is a
 * second label.
 *
 * ANTI-TAUTOLOGY, which is the whole design of this test: the expected digest is computed from
 * `prompts/v1_system.md` READ FROM DISK, never from `SYSTEM_PROMPT` re-imported. Comparing the
 * scorecard's digest to a hash of the same in-memory constant it was built from would pass no
 * matter how badly the load had degraded, including the `undefined` case. That is precisely the
 * shape eval-auditor's Blocking B1 caught in PR A, and the shape code-reviewer caught again in this
 * PR's first replay-fidelity test.
 *
 * WHAT BREAKS THIS TEST:
 *   - edit prompts/v1_system.md without regenerating the module  -> digests diverge, fails
 *   - regenerate the module from a different file                -> digests diverge, fails
 *   - degrade SYSTEM_PROMPT to undefined or empty                -> fails (see the second test)
 *   - stamp the digest of anything other than the wire text      -> fails
 */

const promptPath = fileURLToPath(new URL("../../../prompts/v1_system.md", import.meta.url));

/** The digest of what actually goes on the wire: the file's TRIMMED bytes. */
function committedPromptDigest(): string {
  return createHash("sha256").update(readFileSync(promptPath, "utf8").trim()).digest("hex");
}

describe("scorecard prompt digest is bound to the committed prompt file (R1)", () => {
  test("the stamped digest equals the digest of prompts/v1_system.md", () => {
    const card = buildScorecard([], [], null);
    expect(
      card.prompt_sha256,
      "the scorecard's prompt_sha256 does not match the committed prompt file. Either the .md was " +
        "edited without regenerating the module (the L5-C5 drift gate should also be red), or the " +
        "scorecard is hashing something other than the text that goes on the wire.",
    ).toBe(committedPromptDigest());
  });

  test("the digest is of real content, not of an empty or missing prompt", () => {
    // Guards the degenerate pass: sha256("") is a fixed, well-known value, and a scorecard built
    // from a failed prompt load would stamp it while still "matching" nothing in particular.
    const emptyDigest = createHash("sha256").update("").digest("hex");
    expect(buildScorecard([], [], null).prompt_sha256).not.toBe(emptyDigest);
    expect(committedPromptDigest()).not.toBe(emptyDigest);
  });

  test("the digest is stamped as a 64-char hex string", () => {
    expect(buildScorecard([], [], null).prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
