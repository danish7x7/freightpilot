import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/** The repo-root prompt file (L5-C5 pins it there). Resolved from this test file, three levels up. */
function promptPath(): string {
  return fileURLToPath(new URL(`../../../prompts/${agentPromptVersion}_system.md`, import.meta.url));
}

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

  /**
   * L5-C2b, the EVAL half. Its twin is in services/agent/test/prompt/systemPrompt.test.ts.
   *
   * REPLACES "at v0-none the driven request carries NO system message", which asserted the
   * promptless baseline and is false by construction now that a prompt exists.
   *
   * ANTI-TAUTOLOGY: the expected value is read from `prompts/v1_system.md` ON DISK, never from a
   * re-imported `SYSTEM_PROMPT`. Comparing the driven request to the constant it was built from
   * passes even when the load has degraded to empty, because both sides collapse together. That is
   * the shape of eval-auditor's Blocking B1 from PR A, where the equality assertions were
   * tautological at `v0-none`. Note the test above deliberately DOES compare against the composer's
   * output, because its question is "same composer, both paths"; this one's question is "the real
   * bytes", and only a disk read can answer it.
   *
   * This is the assertion that closes hazard H1 for the eval path: without it, 30-odd cases could
   * replay a promptless path while the scorecard is stamped `v1`.
   */
  test("the driven eval request carries the PRODUCTION prompt read from disk (L5-C2b)", async () => {
    const onDisk = readFileSync(promptPath(), "utf8").trim();
    const seen: { req?: ChatRequest } = {};

    await scoreCase(singleTurnCase, { makeRouter: () => capturingRouter(seen) });

    const system = seen.req?.messages.filter((m) => m.role === "system") ?? [];
    // Exactly one: a second system message would mean a case smuggled its own in beside production's
    // (caseSchema forbids the `system` role for precisely this reason).
    expect(system).toHaveLength(1);
    expect(system[0].content).toBe(onDisk);
    expect(system[0].content.length).toBeGreaterThan(0);
  });

  test("the runner's PROMPT_VERSION is agent-service's constant, not a copy", () => {
    // Catches the drift that matters — a reintroduced literal in promptVersion.ts whose VALUE
    // diverges from the service's (e.g. one of the two bumped and not the other). It does not
    // detect a reintroduced literal that happens to hold the same string; that stays a review
    // property, since both symbols resolve through the same module today.
    expect(runnerPromptVersion).toBe(agentPromptVersion);
  });
});
