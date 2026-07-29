/**
 * The ONE seam to services/agent. Every runner module imports the real production code
 * through this barrel so the relative path (and the "we drive the shipped code, never a
 * reimplementation" invariant, Prime Directive 1) lives in exactly one place.
 *
 * These are agent SOURCE files imported by relative path and executed under tsx/esbuild
 * (no build step). Their transitive deps (zod, openapi-fetch, drizzle-orm, postgres) resolve
 * from services/agent/node_modules — so services/agent must be installed (CI's evals job
 * installs it; `make evals` installs it). We import; we NEVER redefine tool schemas, the Zod
 * validators, or the loop.
 *
 * Zero production-code changes (Prime Directive 2): everything here is already exported by
 * agent-service. If this file ever needs an export that does not exist yet, that is a
 * production touch — stop and flag it in the PR for security-reviewer (the §0.2 tripwire).
 *
 * L5 PR A DELIBERATELY trips that tripwire, once, and it is flagged: `composeMessages`,
 * `SYSTEM_PROMPT` and `PROMPT_VERSION` are NEW agent-service exports created by this PR. That is
 * the point of the PR — the runner must drive the SAME message composer production drives
 * (condition C1 / hazard H1), and the prompt version must be owned by the service that logs it
 * (condition C3). Importing them here is what makes the seam single-sourced; re-implementing any
 * of the three in the runner would recreate the divergence.
 */
export { runAgentTurn } from "../../../services/agent/src/loop/agentLoop.js";
export type {
  AgentTurnResult,
  RunAgentTurnArgs,
  AgentLogger,
} from "../../../services/agent/src/loop/agentLoop.js";

export { TOOLS } from "../../../services/agent/src/tools/index.js";
export type {
  Tool,
  ToolClients,
  ToolExecution,
  ToolResult,
  CreateBookingProposal,
} from "../../../services/agent/src/tools/index.js";

export { LlmRouter, TokenBucket, createProvider, loadLlmConfig, LlmError } from "../../../services/agent/src/llm/index.js";
export type { LlmErrorKind } from "../../../services/agent/src/llm/index.js";
export type {
  LlmProvider,
  ChatRequest,
  ChatResponse,
  LlmMessage,
  LlmToolSchema,
  NormalizedToolCall,
  LlmUsage,
  RouterEntry,
} from "../../../services/agent/src/llm/index.js";

export {
  composeMessages,
  SYSTEM_PROMPT,
  PROMPT_VERSION,
} from "../../../services/agent/src/prompt/systemPrompt.js";

export { runTurn } from "../../../services/agent/src/turn/turnService.js";
export type { TurnDeps, TurnReply, TurnInput } from "../../../services/agent/src/turn/turnService.js";
export type { GateDeps } from "../../../services/agent/src/gate/gateService.js";

export type { Db } from "../../../services/agent/src/db/client.js";
export type { RatesClient } from "../../../services/agent/src/api/rates.js";
export type { BookingClient } from "../../../services/agent/src/api/booking.js";
