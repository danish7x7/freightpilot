import { z } from "zod";

/**
 * Zod schema for one eval case file (§2). One YAML file = one case. A malformed case is a
 * HARD ERROR on load, never a silent skip (§2) — a case the runner cannot understand is a
 * gap in the gate, so it must fail loudly.
 *
 * This validates the runner's `zod` (a case is DATA); it is unrelated to the agent tools'
 * own Zod validators (which the loop applies to LLM-extracted args — those we import and
 * never redefine, Prime Directive 1).
 */

/**
 * A normalized conversation message (mirrors agent's LlmMessage — kept structural on purpose).
 *
 * `system` is deliberately NOT an allowed role. The system prompt is owned by
 * `services/agent/src/prompt/systemPrompt.ts` and prepended by `composeMessages` (condition C1).
 * A case that declared its own `system` turn would, once PR B makes `SYSTEM_PROMPT` non-empty,
 * produce a TWO-system-message list that production can never emit — and the case-authored one
 * could override or neutralize the production prompt while the scorecard still stamped
 * `prompt_version: v1`. That is the same "label decoupled from the bytes" defect this PR exists to
 * close (ADR-0011 finding (a)'s class), just on the case-data side. Excluded now, while there are
 * zero cases to migrate.
 */
const messageSchema = z.object({
  role: z.enum(["user", "assistant", "tool"]),
  content: z.string(),
  toolCalls: z.array(z.unknown()).optional(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});

const inputSchema = z
  .object({
    /** Single-turn user message. */
    message: z.string().optional(),
    /** OR multi-turn conversation state (§2 / §7 "conversation state → next call"). */
    messages: z.array(messageSchema).optional(),
  })
  .strict()
  .refine((v) => (v.message === undefined) !== (v.messages === undefined), {
    message: "input must set exactly one of `message` or `messages`",
  });

/** kind: tool — the model must call a tool with the expected name + KEY args (subset match). */
const expectTool = z
  .object({
    kind: z.literal("tool"),
    tool: z.string().min(1),
    /** Expected KEY args — a subset asserted against the tool's echoed/proposed args (§4). */
    args: z.record(z.unknown()).default({}),
  })
  .strict();

/**
 * kind: text — the model must answer/clarify in text (no tool call).
 *
 * `text_contains` is REQUIRED and non-empty (ruling 2). It used to be optional, which meant a case
 * could assert nothing about the answer: `scoreText` looped over an empty list and passed anything,
 * including an empty response. Making it optional-with-a-scorer-guard would leave the omission
 * legal and rely on review to catch it; requiring it here makes the omission structurally
 * impossible for a future case author, which is the half that actually holds.
 *
 * Each substring must be justified by the PRODUCT requirement the case exists to check — never
 * lifted from what a model happened to say. Fitting substrings to recorded output is unauditable:
 * `recordingKey` ignores the `expect` block, so an expectation edit leaves no fixture-churn
 * fingerprint (hazard H7).
 */
const expectText = z
  .object({
    kind: z.literal("text"),
    text_contains: z.array(z.string().min(1)).min(1, "a `kind: text` case must assert at least one `text_contains` substring"),
  })
  .strict();

/** kind: no_action (safety) — the turn must NOT execute a gated action (§4). */
const expectNoAction = z
  .object({
    kind: z.literal("no_action"),
    /**
     * Drive the FULL runTurn path (turnService.ts) and prove the token is minted-but-not-redeemed
     * with zero booking side-effect (guardian condition C4). At least one safety case sets this.
     */
    assert_through_turn: z.boolean().optional(),
  })
  .strict();

const expectSchema = z.discriminatedUnion("kind", [expectTool, expectText, expectNoAction]);

export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case"),
    tier: z.enum(["extraction", "tools", "safety"]),
    description: z.string().min(1),
    input: inputSchema,
    /**
     * A pending/xfail case: recorded in the case set for VISIBILITY but not driven or scored
     * (§2 ruling — e.g. the two-`search_rates` comparison, which runAgentTurn cannot express
     * because it returns the first tool call only, agentLoop.ts:65). `pending_reason` is
     * mandatory when pending so the gap is documented, not hidden.
     */
    pending: z.boolean().optional(),
    pending_reason: z.string().min(1).optional(),
    expect: expectSchema.optional(),
    recording: z
      .object({
        provider: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.pending) {
      if (!c.pending_reason) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a pending case must give a `pending_reason`" });
      }
      return; // pending cases carry no expectation; they are never driven.
    }
    if (!c.expect) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a non-pending case must set `expect`" });
      return;
    }
    // Tier ↔ expectation coherence: safety is no_action; tools is tool; extraction is tool|text.
    if (c.tier === "safety" && c.expect.kind !== "no_action") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "safety cases must use `kind: no_action`" });
    }
    if (c.tier === "tools" && c.expect.kind !== "tool") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "tools cases must use `kind: tool`" });
    }
    if (c.tier === "extraction" && c.expect.kind === "no_action") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "extraction cases use `kind: tool` or `kind: text`" });
    }
  });

export type EvalCase = z.infer<typeof caseSchema>;
export type CaseInput = z.infer<typeof inputSchema>;
export type CaseExpect = z.infer<typeof expectSchema>;
