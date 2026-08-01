/**
 * The prompt version, RE-EXPORTED from agent-service (guardian condition C3).
 *
 * This file used to hold the literal itself. It must not: the version is logged on every
 * production LLM request (§6.3.5) AND stamped into every scorecard, so two constants can drift and
 * a scorecard could claim `v1` while the service ships `v2`. Ownership therefore sits with the
 * service that emits it — `services/agent/src/prompt/systemPrompt.ts` — and the runner consumes it
 * through the barrel like every other piece of production code it drives.
 *
 * `v1` is the first real prompt: `prompts/v1_system.md`, embedded into agent-service at build time.
 * The version is mixed into the replay key (§3), so bumping it from `v0-none` (in agent-service,
 * not here) invalidated every promptless recording and the whole set is re-captured against v1.
 * That invalidation is correct and deliberate, not collateral damage: the prompt is inside the
 * keyed `messages`, so bytes captured without it cannot describe behaviour with it.
 *
 * This module remains the runner's import site — `recordingKey.ts`, `scorecard.ts` and `run.ts` all
 * read it from here — so the barrel hop lives in one place rather than three.
 */
export { PROMPT_VERSION } from "./agent.js";
