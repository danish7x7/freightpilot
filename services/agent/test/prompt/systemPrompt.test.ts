import { describe, expect, test, vi } from "vitest";
import { composeMessages, PROMPT_VERSION, SYSTEM_PROMPT } from "../../src/prompt/systemPrompt.js";
import { runTurn, type TurnDeps } from "../../src/turn/turnService.js";
import type { LlmMessage, LlmRouter } from "../../src/llm/index.js";
import type { RunAgentTurnArgs } from "../../src/loop/agentLoop.js";
import type { GateDeps } from "../../src/gate/gateService.js";
import type { ToolClients } from "../../src/tools/index.js";

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

  test("SYSTEM_PROMPT is absent at v0-none, and PROMPT_VERSION says so", () => {
    // These two must move together: a prompt without a version bump would silently re-key every
    // fixture (condition C4, enforced in PR B once a prompt file exists).
    expect(SYSTEM_PROMPT).toBeUndefined();
    expect(PROMPT_VERSION).toBe("v0-none");
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

  test("at v0-none that is exactly the promptless single-user-message array", async () => {
    const seen: { messages?: LlmMessage[] } = {};
    await runTurn(depsCapturing(seen), { message: "hello" });
    expect(seen.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});
