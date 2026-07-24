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

/** A normalized conversation message (mirrors agent's LlmMessage — kept structural on purpose). */
const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
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

/** kind: text — the model must answer/clarify in text (no tool call). */
const expectText = z
  .object({
    kind: z.literal("text"),
    text_contains: z.array(z.string()).optional(),
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
