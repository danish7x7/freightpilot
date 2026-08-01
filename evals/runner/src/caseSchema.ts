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
 * TWO needle forms, both normalized to the same shape by `toNeedleGroups` below:
 *
 *  - `text_contains: string[]`: every substring must appear. Each becomes a ONE-member group.
 *  - `text_contains_any: string[][]`: each inner array is an OR group, and the groups are ANDed.
 *
 * `text_contains_any` exists because a single-substring needle asserts a VOCABULARY CHOICE rather
 * than the product rule. The origin-clarification case is the worked example: it requires the word
 * "origin", yet "shipping from" and "a valid departure port" both satisfy the product rule and both
 * fail that needle. Registering an extraction floor while that is true makes the cheapest way to
 * clear the floor writing the word "origin" into the prompt, which is prompt-fitting to an eval,
 * and per hazard H7 it leaves no fixture-churn fingerprint at all because `recordingKey` ignores
 * the `expect` block entirely.
 *
 * Ruling 2's property survives across both forms: a case CANNOT assert nothing. Zero total groups,
 * any empty group, and any blank alternative are each rejected. Both fields are individually
 * optional so that either form alone is legal; the total-group-count refinement is what makes
 * "neither" illegal, and it lives in `caseSchema`'s `superRefine` because `z.discriminatedUnion`
 * rejects a refined (ZodEffects) member at construction time. Placing it on the UNION (rather than
 * on this member) would also work and would sit closer to the schema it constrains; the superRefine
 * was chosen because the tier-versus-kind coherence rules already live there. Note that the schema
 * is no longer the only thing holding ruling 2: `scoreText` fails closed on zero groups, because
 * `toNeedleGroups` erased the compile-time guard that used to catch this (see its comment there).
 *
 * Each substring is justified by the PRODUCT requirement the case exists to check, never lifted
 * from what a model happened to say. For an OR group the ALTERNATIVES ARE FIXED BEFORE ANY CAPTURE
 * RUNS (condition L5-C20's substring-justification discipline, which H7's mitigation rests on).
 * Reading a recorded output first and then adding the alternative it happens to contain is fitting,
 * and it is exactly as invisible to fixture-churn analysis as the defect above.
 */
/**
 * One alternative. Must contain NON-WHITESPACE, not merely be non-empty.
 *
 * `" "` and `"\n"` are substrings of essentially every model answer, so a blank-ish needle asserts
 * nothing while looking asserted. The OR form raises the stakes: in AND form a degenerate needle
 * wastes one slot, but inside an OR group it is satisfied by anything and therefore VOIDS every
 * real alternative beside it. One space in a group of three silently turns the group off.
 */
const needle = z.string().refine((s) => s.trim().length > 0, "a needle must contain non-whitespace");

const expectText = z
  .object({
    kind: z.literal("text"),
    text_contains: z
      .array(needle)
      .min(1, "`text_contains`, when present, must list at least one substring")
      .optional(),
    text_contains_any: z
      .array(z.array(needle).min(1, "each `text_contains_any` group must list at least one alternative"))
      .min(1, "`text_contains_any`, when present, must list at least one group")
      .optional(),
  })
  .strict();

/** One OR group: satisfied when the answer contains ANY of its alternatives. */
export type NeedleGroup = readonly string[];

export type CaseExpectText = z.infer<typeof expectText>;

/**
 * Normalize both needle forms into ONE shape, in EXACTLY ONE PLACE.
 *
 * `scoreText` takes `NeedleGroup[]` and never the raw expect, so there is a single definition of
 * what the two fields mean and no second reading of them can drift from this one. A scorer that
 * branched on which field was set would be two semantics wearing one name.
 *
 * Ordering is deterministic: `text_contains` singletons first, in file order, then the
 * `text_contains_any` groups in file order. Nothing depends on the order (the groups are ANDed),
 * but a stable order keeps failure messages reproducible across runs.
 */
export function toNeedleGroups(expect: CaseExpectText): NeedleGroup[] {
  const groups: NeedleGroup[] = [];
  for (const single of expect.text_contains ?? []) groups.push([single]);
  for (const group of expect.text_contains_any ?? []) groups.push(group);
  return groups;
}

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
    // Ruling 2, across BOTH needle forms: a `kind: text` case cannot assert nothing. Setting
    // neither field leaves `scoreText` iterating zero groups and passing any substantive answer.
    // This lives here rather than on `expectText` because a discriminated-union member cannot be
    // a refined schema; the per-field `.min(1)` guards handle the empty-list and empty-group cases.
    if (c.expect.kind === "text" && toNeedleGroups(c.expect).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a `kind: text` case must assert at least one needle group (`text_contains` or `text_contains_any`)",
      });
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
