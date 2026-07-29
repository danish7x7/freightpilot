import { describe, expect, test } from "vitest";
import {
  composeMessages,
  LlmRouter,
  SYSTEM_PROMPT,
  TokenBucket,
  type ChatRequest,
  type ChatResponse,
  type LlmMessage,
  type LlmProvider,
} from "../src/agent.js";
import { PROMPT_VERSION as agentPromptVersion } from "../src/agent.js";
import { caseSchema, type EvalCase } from "../src/caseSchema.js";
import { PROMPT_VERSION as runnerPromptVersion } from "../src/promptVersion.js";
import { scoreCase } from "../src/score.js";

/**
 * Guardian condition C2a.iii — the EVAL path drives the production composer.
 *
 * This is the half of hazard H1 that bites hardest. `score.ts` drives 30 of the suite's 31 cases
 * through `runAgentTurn` directly, NOT through `runTurn` — so a system prompt added to
 * `turnService` alone would leave nearly the whole suite replaying the promptless path while the
 * scorecard carried the new `prompt_version`. The floor would then be pre-registered and measured
 * against a prompt that never ran, and nothing would notice. That is ADR-0011 finding (a)'s defect
 * class: a label decoupled from the bytes.
 *
 * Asserting on the request the runner actually DRIVES (rather than unit-testing `toMessages`) is
 * deliberate — it is the request that reaches the provider that matters.
 */

/** Captures the ChatRequest the runner sends, then answers with a trivial text response. */
function capturingRouter(seen: { req?: ChatRequest }): LlmRouter {
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

// Parsed through the real schema (not cast) so these probes cannot drift out of the shape the
// suite actually loads.
const singleTurnCase: EvalCase = caseSchema.parse({
  id: "seam-probe-single",
  tier: "extraction",
  description: "probe: single-turn case drives the shared composer",
  input: { message: "quote ocean CNSHA to USOAK on 2026-08-01" },
  expect: { kind: "text", text_contains: ["captured"] },
});

const multiTurnCase: EvalCase = caseSchema.parse({
  id: "seam-probe-multi",
  tier: "extraction",
  description: "probe: multi-turn case drives the shared composer",
  input: {
    messages: [
      { role: "user", content: "I need ocean rates" },
      { role: "assistant", content: "From where?" },
      { role: "user", content: "CNSHA to USOAK" },
    ],
  },
  expect: { kind: "text", text_contains: ["captured"] },
});

describe("the eval runner drives the production message composer (C2a.iii)", () => {
  test("a single-turn case's driven request equals the composer's output", async () => {
    const seen: { req?: ChatRequest } = {};
    await scoreCase(singleTurnCase, { makeRouter: () => capturingRouter(seen) });

    expect(seen.req?.messages).toEqual(
      composeMessages(SYSTEM_PROMPT, [
        { role: "user", content: "quote ocean CNSHA to USOAK on 2026-08-01" },
      ]),
    );
  });

  test("a multi-turn case's driven request equals the composer's output over the conversation", async () => {
    const seen: { req?: ChatRequest } = {};
    await scoreCase(multiTurnCase, { makeRouter: () => capturingRouter(seen) });

    const conversation = multiTurnCase.input.messages as unknown as LlmMessage[];
    expect(seen.req?.messages).toEqual(composeMessages(SYSTEM_PROMPT, conversation));
  });

  test("at v0-none the driven request carries NO system message", async () => {
    const seen: { req?: ChatRequest } = {};
    await scoreCase(singleTurnCase, { makeRouter: () => capturingRouter(seen) });
    expect(seen.req?.messages.some((m) => m.role === "system")).toBe(false);
  });

  test("the runner's PROMPT_VERSION is agent-service's constant, not a copy", () => {
    // Catches the drift that matters — a reintroduced literal in promptVersion.ts whose VALUE
    // diverges from the service's (e.g. one of the two bumped and not the other). It does not
    // detect a reintroduced literal that happens to hold the same string; that stays a review
    // property, since both symbols resolve through the same module today.
    expect(runnerPromptVersion).toBe(agentPromptVersion);
  });
});
