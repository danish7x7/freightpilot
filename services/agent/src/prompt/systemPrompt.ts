import { createHash } from "node:crypto";
import type { LlmMessage } from "../llm/index.js";
import { PROMPT_SOURCE_FILENAME, PROMPT_TEXT } from "./v1_system.gen.js";

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
 * FAIL-FAST on a blank prompt (guardian condition L5-C6).
 *
 * NO TRY/CATCH ANYWHERE IN THIS LOAD PATH, deliberately. Hazard H3's failure-mode ordering note is
 * why L5-C6 exists: a try/catch buys a container that boots PROMPTLESS and green while the eval
 * suite certifies a prompted path, which is strictly worse than a crash because nothing reports it.
 *
 * Under the generated-module approach a MISSING file is already a build failure (codegen throws,
 * and the import would not resolve), so the residual runtime risk is narrower and sneakier: an
 * EMPTY or whitespace-only `.md`. `composeMessages` treats blank as "no prompt" and returns the
 * conversation unchanged, so without this check an empty prompt file is a silent promptless boot
 * carrying a `v1` label. That is finding (a)'s exact shape.
 *
 * UNCONDITIONAL: this runs at module load, independent of `LLM_CHAIN` and of whether any API key is
 * set. Gate-only boot mode (server.ts catches an unconfigured chain and serves without POST /turns)
 * does NOT skip it, because the prompt is not the chain's business.
 *
 * Mutation that must break this: blank `prompts/v1_system.md`, run `pnpm gen:prompt`, boot.
 */
if (PROMPT_TEXT.trim().length === 0) {
  throw new Error(
    `system prompt is empty (generated from prompts/${PROMPT_SOURCE_FILENAME}): refusing to boot promptless`,
  );
}

/**
 * The production system prompt: the trimmed contents of `prompts/v1_system.md`, embedded at build
 * time by `scripts/gen-prompt.ts`.
 *
 * Typed `string | undefined` rather than inferred. The type is deliberately WIDER than the current
 * value: `composeMessages` still has to handle the absent case, and narrowing this to `string`
 * would make that branch look dead to the type checker and invite someone to delete it.
 */
export const SYSTEM_PROMPT: string | undefined = PROMPT_TEXT;

/** The prompt file the text came from. Checked against `PROMPT_VERSION` (condition L5-C4). */
export const PROMPT_SOURCE = PROMPT_SOURCE_FILENAME;

/**
 * sha256 over the TRIMMED text, which is what `composeMessages` actually sends. Taking it over the
 * untrimmed file would produce a digest for bytes that never go on the wire: the `.md` ends with a
 * trailing newline and the wire form does not.
 *
 * SCOPE, stated precisely because an overclaim here would be its own version of the defect this
 * layer exists to close: today this is stamped into the BOOT LOG ONLY. It is audit evidence, not an
 * enforced binding, and nothing compares it against anything at runtime. Stamping it into the
 * scorecard beside `prompt_version` (reviewer addition R1, accepted) is Part 7's work and has not
 * landed, so do not read this constant as already binding the label to the bytes.
 *
 * What DOES bind them today is `recordingKey`, which hashes the full `messages` array with the
 * prompt inside it: a changed prompt cannot replay old fixtures. That is real, and it is a
 * different mechanism from this digest.
 */
export const PROMPT_SHA256 = createHash("sha256").update(PROMPT_TEXT).digest("hex");

/** Bytes of the trimmed prompt, for the boot log. */
export const PROMPT_BYTES = Buffer.byteLength(PROMPT_TEXT);

/**
 * The prompt version. Stamped into every eval scorecard AND logged on every LLM request via the
 * loop's `llm_extract` line (§6.3.5, condition L5-C14).
 *
 * agent-service OWNS this constant (guardian condition L5-C3). The eval runner re-exports it
 * through its barrel and must not hold its own literal: two constants can diverge, and a scorecard
 * that says `v1` while the service ships `v2` is exactly the provenance defect this project has
 * already been bitten by once.
 *
 * TIED TO THE PROMPT FILENAME (`v1` <-> `v1_system.md`), enforced by test (condition L5-C4): a
 * prompt file swapped without a version bump must fail CI rather than silently re-key every
 * committed fixture. It is bumped by the PR that changes the prompt, never independently.
 */
export const PROMPT_VERSION = "v1";

/**
 * Compose the message list handed to the provider: the system prompt (when there is one) followed
 * by the conversation.
 *
 * An absent, empty, or whitespace-only prompt is treated as NO prompt and returns the conversation
 * unchanged: a blank `system` message would change every recording key while steering nothing.
 *
 * That branch is not dead code even though `SYSTEM_PROMPT` is now always a non-empty string. It is
 * what the composer's own unit tests drive with a sentinel, and it is the behaviour the L5-C6
 * fail-fast above exists to keep unreachable IN PRODUCTION: the guard throws at module load rather
 * than letting a blank prompt reach here and silently produce a promptless request stamped `v1`.
 */
export function composeMessages(
  systemPrompt: string | undefined,
  conversation: readonly LlmMessage[],
): LlmMessage[] {
  const trimmed = systemPrompt?.trim();
  if (!trimmed) return [...conversation];
  return [{ role: "system", content: trimmed }, ...conversation];
}
