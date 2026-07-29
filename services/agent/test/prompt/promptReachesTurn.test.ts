import { describe, expect, test, vi } from "vitest";
import type { LlmMessage, LlmRouter } from "../../src/llm/index.js";
import type { RunAgentTurnArgs } from "../../src/loop/agentLoop.js";
import type { GateDeps } from "../../src/gate/gateService.js";
import type { ToolClients } from "../../src/tools/index.js";

/**
 * C2a.ii with TEETH — the production turn path must obtain its messages from the composer.
 *
 * The sibling assertions in `systemPrompt.test.ts` compare the driven request against
 * `composeMessages(SYSTEM_PROMPT, conv)`. At `v0-none` that is a TAUTOLOGY: `SYSTEM_PROMPT` is
 * undefined, so the composer is the identity function and the comparison passes just as well
 * against a hand-built array. eval-auditor proved it by reverting both call sites and watching all
 * eleven seam tests stay green. A guard for the hazard this PR exists to close (H1) that cannot
 * fail when the mechanism is removed is not a guard.
 *
 * This file closes that without waiting for a prompt file: it MOCKS `SYSTEM_PROMPT` to a sentinel
 * — leaving the real `composeMessages` in place — so the composer stops being the identity and the
 * assertion becomes falsifiable TODAY. Bypass the composer in `turnService` and this fails.
 *
 * It does not prove C2b (that the real production prompt text is threaded in); that needs a prompt
 * to exist and lands in PR B.
 */

const SENTINEL = "SENTINEL SYSTEM PROMPT — proves the call site reads SYSTEM_PROMPT";

vi.mock("../../src/prompt/systemPrompt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/prompt/systemPrompt.js")>();
  // Real composeMessages, sentinel prompt: the call site must pass the constant INTO the composer.
  return { ...actual, SYSTEM_PROMPT: SENTINEL };
});

const { runTurn } = await import("../../src/turn/turnService.js");

describe("the production turn path drives the composer (C2a.ii, falsifiable)", () => {
  test("runTurn's driven request carries the system prompt as its leading message", async () => {
    const seen: { messages?: LlmMessage[] } = {};
    await runTurn(
      {
        gate: {} as GateDeps,
        router: {} as LlmRouter,
        tools: [],
        clients: {} as ToolClients,
        runLoop: vi.fn(async (args: RunAgentTurnArgs) => {
          seen.messages = args.messages as LlmMessage[];
          return { kind: "text" as const, text: "ok" };
        }),
      },
      { message: "quote CNSHA to USOAK" },
    );

    // A hand-built [{role:"user"}] in turnService fails HERE — which is the whole point.
    expect(seen.messages?.[0]).toEqual({ role: "system", content: SENTINEL });
    expect(seen.messages?.[1]).toEqual({ role: "user", content: "quote CNSHA to USOAK" });
    expect(seen.messages).toHaveLength(2);
  });
});
