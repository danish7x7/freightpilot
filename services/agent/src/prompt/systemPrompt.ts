import type { LlmMessage } from "../llm/index.js";

/**
 * The ONE place a request's message list is composed (guardian condition C1).
 *
 * Before this module existed there were two composition sites — `turnService.runTurn` built its
 * own `[{role:"user"}]` array, and the eval runner's `toMessages()` built one from case YAML. That
 * is guardian hazard H1: add a system prompt to the production path alone and the eval suite keeps
 * replaying the PROMPTLESS path while its scorecard is stamped with the new `prompt_version` — a
 * label decoupled from the bytes, which is the same defect class as ADR-0011 finding (a). Both
 * paths now route through `composeMessages`, so a prompt cannot reach production without also
 * reaching the thing that measures production.
 *
 * `composeMessages` is a PURE function and takes the prompt as a PARAMETER so it is testable
 * without a prompt file existing. That parameter is not a seam for callers to vary: production
 * call sites pass `SYSTEM_PROMPT` and nothing else (condition C2a), and no test-only override may
 * let the eval path supply a different prompt than production.
 */

/**
 * The production system prompt. `undefined` at `v0-none` — the promptless baseline, where the loop
 * is driven by the user message + the tool schemas alone.
 *
 * PR B (L5) authors `prompts/v1_system.md`, loads it here, and bumps `PROMPT_VERSION` — at which
 * point `composeMessages` starts prepending a `system` message, every recording key changes, and
 * the whole fixture set is re-captured. Typed as `string | undefined` rather than inferred, so the
 * `v0-none` value does not narrow to the `undefined` literal and make the prompted branch look
 * unreachable to the type checker.
 */
export const SYSTEM_PROMPT: string | undefined = undefined;

/**
 * The prompt version. Stamped into every eval scorecard today; it will additionally be logged on
 * every production LLM request when PR B wires it into the loop's `llm_extract` log (§6.3.5) —
 * nothing in agent-service reads this constant yet.
 *
 * agent-service OWNS this constant (guardian condition C3). The eval runner re-exports it through
 * its barrel and must not hold its own literal: two constants can diverge, and a scorecard that
 * says `v1` while the service ships `v2` is exactly the provenance defect this project has already
 * been bitten by once.
 *
 * `v0-none` = promptless. It is bumped by the PR that authors the prompt, never independently.
 */
export const PROMPT_VERSION = "v0-none";

/**
 * Compose the message list handed to the provider: the system prompt (when there is one) followed
 * by the conversation.
 *
 * At `v0-none` `systemPrompt` is undefined and this returns the conversation UNCHANGED — byte-
 * identical to what both call sites built by hand before, which is what keeps every committed
 * recording key valid across this refactor. An empty or whitespace-only prompt is treated as no
 * prompt: a blank `system` message would change every recording key while steering nothing.
 */
export function composeMessages(
  systemPrompt: string | undefined,
  conversation: readonly LlmMessage[],
): LlmMessage[] {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) return [...conversation];
  return [{ role: "system", content: trimmed }, ...conversation];
}
