import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

/**
 * L5-C6's guard, guarded.
 *
 * WHY THIS FILE EXISTS. The fail-fast in `systemPrompt.ts` and the empty-check in
 * `scripts/gen-prompt.ts` both worked, and both could be DELETED with the entire suite staying
 * green: 21 files, 105 tests, all passing. code-reviewer found this by running the mutation the
 * docstring describes. LEARNING.md records the same ruling from PR A in as many words: "a guard for
 * the hazard this PR exists to close that cannot fail when the mechanism is removed is not a
 * guard." A mutation written in a comment and never run by CI is a manual step, and manual steps
 * are skipped.
 *
 * What the two guards are for: a blank prompt is the one degradation the generated-module approach
 * cannot turn into a build error. A missing file fails at codegen and again at import resolution,
 * but an EMPTY file generates a perfectly valid module exporting `""`, and `composeMessages` treats
 * blank as "no prompt" and silently returns the conversation unchanged. That is a promptless
 * container carrying a `v1` label, which is ADR-0011 finding (a)'s exact shape.
 */

const agentRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("L5-C6: a blank prompt refuses to load", () => {
  /**
   * MUTATION: delete the `if (PROMPT_TEXT.trim().length === 0) throw` block in systemPrompt.ts.
   *
   * Mocks only the GENERATED module and dynamically imports the real `systemPrompt.ts`, so the
   * assertion runs against production code rather than a reimplementation. Same `vi.mock` plus
   * dynamic-import shape the runner already uses in composerSeamMocked.test.ts.
   */
  test("a whitespace-only generated prompt throws at module load, with no try/catch to swallow it", async () => {
    vi.resetModules();
    vi.doMock("../../src/prompt/v1_system.gen.js", () => ({
      PROMPT_TEXT: "   \n\t ",
      PROMPT_SOURCE_FILENAME: "v1_system.md",
    }));

    await expect(import("../../src/prompt/systemPrompt.js")).rejects.toThrow(/refusing to boot promptless/);

    vi.doUnmock("../../src/prompt/v1_system.gen.js");
    vi.resetModules();
  });

  test("an EMPTY generated prompt throws too, not only a whitespace one", async () => {
    vi.resetModules();
    vi.doMock("../../src/prompt/v1_system.gen.js", () => ({
      PROMPT_TEXT: "",
      PROMPT_SOURCE_FILENAME: "v1_system.md",
    }));

    await expect(import("../../src/prompt/systemPrompt.js")).rejects.toThrow(/refusing to boot promptless/);

    vi.doUnmock("../../src/prompt/v1_system.gen.js");
    vi.resetModules();
  });

  /**
   * MUTATION: delete the `if (text.length === 0) throw` block in scripts/gen-prompt.ts.
   *
   * The second, independent guard. Shells the real script against a blank source rather than
   * importing it, because the script is side-effecting: it writes the module on load. Running it
   * out-of-process also proves the EXIT CODE is non-zero, which is what makes the CI step fail
   * rather than quietly emitting an empty module for the drift gate to then bless.
   */
  test("gen-prompt.ts exits non-zero on a blank source rather than emitting a promptless module", () => {
    const fakeRepo = mkdtempSync(join(tmpdir(), "genprompt-blank-"));
    // Mirror the layout the script walks: <repo>/prompts/v1_system.md, resolved from its own path.
    const scriptDir = join(fakeRepo, "services", "agent", "scripts");
    execFileSync("mkdir", ["-p", scriptDir, join(fakeRepo, "prompts"), join(fakeRepo, "services", "agent", "src", "prompt")]);
    execFileSync("cp", [join(agentRoot, "scripts", "gen-prompt.ts"), scriptDir]);
    writeFileSync(join(fakeRepo, "prompts", "v1_system.md"), "   \n\t \n");

    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync("npx", ["tsx", join(scriptDir, "gen-prompt.ts")], { cwd: agentRoot, stdio: "pipe" });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer };
      exitCode = e.status ?? -1;
      stderr = e.stderr?.toString() ?? "";
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/refusing to generate a promptless module/);
  });
});
