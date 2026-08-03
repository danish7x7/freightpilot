import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import {
  composeMessages,
  PROMPT_BYTES,
  PROMPT_SHA256,
  PROMPT_SOURCE,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "../../src/prompt/systemPrompt.js";
import { runTurn, type TurnDeps } from "../../src/turn/turnService.js";
import type { LlmMessage, LlmRouter } from "../../src/llm/index.js";
import type { RunAgentTurnArgs } from "../../src/loop/agentLoop.js";
import type { GateDeps } from "../../src/gate/gateService.js";
import type { ToolClients } from "../../src/tools/index.js";

/**
 * The repo-root prompt file (condition L5-C5 pins it there by absolute path; there is deliberately
 * no `services/agent/prompts/`). Resolved from this test file, four levels up.
 */
function promptPath(): string {
  return fileURLToPath(new URL(`../../../../prompts/${PROMPT_SOURCE}`, import.meta.url));
}

/**
 * Guardian condition C2a — the composer, and the production path's use of it.
 *
 * H1 (the hazard this PR exists to close) factors into three propositions:
 *   1. the composer, given a system prompt, emits it as a `system` message;
 *   2. every driven path obtains its messages from that composer and nowhere else;
 *   3. the production prompt VALUE is threaded into the composer at both call sites.
 *
 * (1) and (2) are proven here and in the runner's companion test — (1) with a SENTINEL prompt, so
 * it needs no prompt file to exist. (3) is NOT provable until a prompt exists; it lands as C2b in
 * PR B. That gap is stated in the PR description rather than papered over.
 */

const sentinel = "SENTINEL SYSTEM PROMPT — not the production prompt";

describe("composeMessages (C2a.i)", () => {
  test("given a prompt, emits it as the leading `system` message", () => {
    const out = composeMessages(sentinel, [{ role: "user", content: "hello" }]);
    expect(out[0]).toEqual({ role: "system", content: sentinel });
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ role: "user", content: "hello" });
  });

  test("preserves multi-turn conversation order after the system message", () => {
    const conversation: LlmMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ];
    const out = composeMessages(sentinel, conversation);
    expect(out.map((m) => m.content)).toEqual([sentinel, "first", "second", "third"]);
  });

  test("no prompt returns the conversation UNCHANGED — the v0-none key-neutrality guarantee", () => {
    const conversation: LlmMessage[] = [{ role: "user", content: "hello" }];
    // This is the property that keeps all 30 committed recordings valid across this refactor: at
    // v0-none the composer must produce byte-identical output to the hand-built array it replaced.
    expect(composeMessages(undefined, conversation)).toEqual(conversation);
    expect(composeMessages("", conversation)).toEqual(conversation);
    // Whitespace-only is treated as absent: a blank system message would change every recording
    // key while steering nothing.
    expect(composeMessages("   \n\t ", conversation)).toEqual(conversation);
  });

  test("does not mutate or alias the caller's conversation array", () => {
    const conversation: LlmMessage[] = [{ role: "user", content: "hello" }];
    const out = composeMessages(undefined, conversation);
    expect(out).not.toBe(conversation);
    out.push({ role: "user", content: "mutation" });
    expect(conversation).toHaveLength(1);
  });

  /**
   * L5-C4: the version identifier is tied to the prompt FILENAME, enforced here.
   *
   * REWRITTEN, not supplemented. This test previously asserted `SYSTEM_PROMPT` was `undefined` and
   * `PROMPT_VERSION` was `"v0-none"`, with a comment forward-referencing this condition to PR B.
   * That body goes red the moment the version is bumped, so leaving it in place and adding a second
   * test beside it would have left two competing claims about one constant with one of them
   * failing. The forward reference is now the implementation.
   *
   * What this buys: a prompt file swapped WITHOUT a version bump fails CI instead of silently
   * re-keying every committed fixture, since `recordingKey` hashes `prompt_version` and would
   * happily accept `v1` over different bytes.
   */
  test("PROMPT_VERSION matches the prompt filename it was generated from (L5-C4)", () => {
    expect(PROMPT_SOURCE).toBe(`${PROMPT_VERSION}_system.md`);
  });

  test("the generated text equals the .md on disk, byte for byte (trimmed)", () => {
    // Read from DISK rather than comparing the generated module to itself, which would be
    // self-referential and pass no matter how far the two had drifted. Trimmed on both sides
    // because trimmed is what `composeMessages` puts on the wire.
    const onDisk = readFileSync(promptPath(), "utf8").trim();
    expect(SYSTEM_PROMPT).toBe(onDisk);
  });

  test("the prompt is non-empty, and PROMPT_BYTES / PROMPT_SHA256 describe the wire form", () => {
    // The digest must be over the TRIMMED text, not the file: the .md ends with a trailing newline
    // and the wire form does not, so digesting the file would label bytes that are never sent.
    const wire = readFileSync(promptPath(), "utf8").trim();
    expect(wire.length).toBeGreaterThan(0);
    expect(PROMPT_BYTES).toBe(Buffer.byteLength(wire));
    expect(PROMPT_SHA256).toBe(createHash("sha256").update(wire).digest("hex"));
  });
});

describe("runTurn drives the composer, not a hand-built array (C2a.ii)", () => {
  function depsCapturing(seen: { messages?: LlmMessage[] }): TurnDeps {
    return {
      gate: {} as GateDeps,
      router: {} as LlmRouter,
      tools: [],
      clients: {} as ToolClients,
      runLoop: vi.fn(async (args: RunAgentTurnArgs) => {
        seen.messages = args.messages as LlmMessage[];
        return { kind: "text" as const, text: "ok" };
      }),
    };
  }

  test("the request driven by runTurn equals the composer's output for the same input", async () => {
    const seen: { messages?: LlmMessage[] } = {};
    await runTurn(depsCapturing(seen), { message: "quote CNSHA to USOAK" });

    expect(seen.messages).toEqual(
      composeMessages(SYSTEM_PROMPT, [{ role: "user", content: "quote CNSHA to USOAK" }]),
    );
  });

  /**
   * L5-C2b, the production half: the request `runTurn` actually drives carries the PRODUCTION
   * prompt text. (The runner's half of C2b lives in evals/runner/test/composerSeam.test.ts.)
   *
   * REPLACES the v0-none assertion that used to sit here, which pinned the promptless
   * single-user-message array and is false by construction now that a prompt exists.
   *
   * ANTI-TAUTOLOGY, and this is the whole point of the test: the expected value is read from
   * `prompts/v1_system.md` ON DISK, never from a re-imported `SYSTEM_PROMPT`. Comparing the driven
   * request against the constant it was built from passes even if the load degraded to empty, since
   * both sides collapse together. That is exactly the defect eval-auditor's Blocking B1 caught in
   * PR A, where the equality assertions were tautological at `v0-none`.
   *
   * Mutation: force `SYSTEM_PROMPT` to `undefined` and this fails; comparing against the import
   * would not.
   */
  test("the driven request carries the PRODUCTION prompt read from disk (L5-C2b)", async () => {
    const onDisk = readFileSync(promptPath(), "utf8").trim();
    const seen: { messages?: LlmMessage[] } = {};

    await runTurn(depsCapturing(seen), { message: "hello" });

    expect(seen.messages).toEqual([
      { role: "system", content: onDisk },
      { role: "user", content: "hello" },
    ]);
    // Belt and braces on the anti-tautology property: a degraded load would leave this empty.
    expect(seen.messages?.[0].content.length).toBeGreaterThan(0);
  });
});
