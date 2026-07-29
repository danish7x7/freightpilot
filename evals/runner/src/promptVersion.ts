/**
 * The prompt version, RE-EXPORTED from agent-service (guardian condition C3).
 *
 * This file used to hold the literal itself. It must not: the version is logged on every
 * production LLM request (§6.3.5) AND stamped into every scorecard, so two constants can drift and
 * a scorecard could claim `v1` while the service ships `v2`. Ownership therefore sits with the
 * service that emits it — `services/agent/src/prompt/systemPrompt.ts` — and the runner consumes it
 * through the barrel like every other piece of production code it drives.
 *
 * `v0-none` = the PROMPTLESS baseline: the composer returns the conversation unchanged, so the loop
 * runs on the user message + tool schemas alone. It is mixed into the replay key (§3), so when the
 * L5 prompt PR bumps it (in agent-service, not here) every v0-none recording invalidates and the
 * whole set is re-captured. The v0-none recordings are THROWAWAY by design (see
 * src/recordings/README.md).
 *
 * This module remains the runner's import site — `recordingKey.ts`, `scorecard.ts` and `run.ts` all
 * read it from here — so the barrel hop lives in one place rather than three.
 */
export { PROMPT_VERSION } from "./agent.js";
