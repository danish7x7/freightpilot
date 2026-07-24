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

export { runTurn } from "../../../services/agent/src/turn/turnService.js";
export type { TurnDeps, TurnReply, TurnInput } from "../../../services/agent/src/turn/turnService.js";
export type { GateDeps } from "../../../services/agent/src/gate/gateService.js";

export type { Db } from "../../../services/agent/src/db/client.js";
export type { RatesClient } from "../../../services/agent/src/api/rates.js";
export type { BookingClient } from "../../../services/agent/src/api/booking.js";
