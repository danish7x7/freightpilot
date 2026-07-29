import { describe, expect, test, vi } from "vitest";
import type { ChatRequest, ChatResponse, LlmProvider } from "../src/agent.js";

/**
 * C2a.iii with TEETH — the EVAL path must obtain its messages from the production composer.
 *
 * This is the half of hazard H1 that actually bites: `score.ts` drives 30 of the suite's 31 cases
 * through `runAgentTurn` directly, so a prompt wired into `turnService` alone would leave nearly
 * the whole suite replaying the promptless path while the scorecard carried the new
 * `prompt_version`. The plain equality assertions in `composerSeam.test.ts` cannot detect that at
 * `v0-none`, because the composer is the identity function there — eval-auditor demonstrated it by
 * reverting `toMessages` to `return conversation;` and watching the seam tests stay green.
 *
 * Mocking `SYSTEM_PROMPT` to a sentinel makes the composer non-identity, so the assertion below
 * fails the moment the runner stops routing through it. The mock targets the agent-service module
 * the runner's barrel re-exports, so both the barrel and `score.ts` observe the sentinel.
 */

const SENTINEL = "SENTINEL SYSTEM PROMPT — proves the eval path reads SYSTEM_PROMPT";

vi.mock("../../../services/agent/src/prompt/systemPrompt.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/agent/src/prompt/systemPrompt.js")>();
  return { ...actual, SYSTEM_PROMPT: SENTINEL };
});

const { LlmRouter, TokenBucket } = await import("../src/agent.js");
const { caseSchema } = await import("../src/caseSchema.js");
const { scoreCase } = await import("../src/score.js");

function capturingRouter(seen: { req?: ChatRequest }) {
  const provider: LlmProvider = {
    name: "capture",
    model: "capture",
    supportsTools: true,
    chat: async (req: ChatRequest): Promise<ChatResponse> => {
      seen.req = req;
      return {
        text: "captured",
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        provider: "capture",
        model: "capture",
      };
    },
  };
  return new LlmRouter([{ provider, bucket: new TokenBucket({ rpm: 1_000_000 }) }]);
}

describe("the eval runner drives the composer (C2a.iii, falsifiable)", () => {
  test("a single-turn case's driven request leads with the system prompt", async () => {
    const seen: { req?: ChatRequest } = {};
    const c = caseSchema.parse({
      id: "seam-mocked-single",
      tier: "extraction",
      description: "probe",
      input: { message: "quote ocean CNSHA to USOAK on 2026-08-01" },
      expect: { kind: "text", text_contains: ["captured"] },
    });

    await scoreCase(c, { makeRouter: () => capturingRouter(seen) });

    // `toMessages` returning the conversation unchanged fails HERE.
    expect(seen.req?.messages[0]).toEqual({ role: "system", content: SENTINEL });
    expect(seen.req?.messages[1]).toEqual({
      role: "user",
      content: "quote ocean CNSHA to USOAK on 2026-08-01",
    });
  });

  test("a multi-turn case's driven request leads with the system prompt, conversation intact", async () => {
    const seen: { req?: ChatRequest } = {};
    const c = caseSchema.parse({
      id: "seam-mocked-multi",
      tier: "extraction",
      description: "probe",
      input: {
        messages: [
          { role: "user", content: "I need ocean rates" },
          { role: "assistant", content: "From where?" },
          { role: "user", content: "CNSHA to USOAK" },
        ],
      },
      expect: { kind: "text", text_contains: ["captured"] },
    });

    await scoreCase(c, { makeRouter: () => capturingRouter(seen) });

    expect(seen.req?.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(seen.req?.messages[0]?.content).toBe(SENTINEL);
  });

  test("exactly ONE system message reaches the model — cases cannot smuggle a second", async () => {
    // Pairs with caseSchema's exclusion of `role: "system"` from case messages: production can
    // only ever emit one system turn, so the suite must never measure a two-system-message list.
    const seen: { req?: ChatRequest } = {};
    const c = caseSchema.parse({
      id: "seam-mocked-single-system",
      tier: "extraction",
      description: "probe",
      input: { message: "hello" },
      expect: { kind: "text", text_contains: ["captured"] },
    });

    await scoreCase(c, { makeRouter: () => capturingRouter(seen) });

    expect(seen.req?.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });
});
