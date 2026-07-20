/**
 * Public entrypoint for the LLM adapter (agent-phase L1 / global L5). L2 (the agent
 * tool loop) depends only on this barrel — `buildLlmRouter(env)` + the normalized
 * types — never on individual providers or wire formats.
 */
import { loadLlmConfig, type ResolvedProvider } from "./config.js";
import { GeminiProvider } from "./geminiProvider.js";
import { OpenAiCompatProvider } from "./openAiCompatProvider.js";
import { LlmRouter, type LlmLogger, type RouterEntry } from "./router.js";
import { TokenBucket } from "./tokenBucket.js";
import type { LlmProvider } from "./types.js";

export { LlmRouter } from "./router.js";
export type { LlmLogger, RouterEntry } from "./router.js";
export { TokenBucket } from "./tokenBucket.js";
export { GeminiProvider } from "./geminiProvider.js";
export { OpenAiCompatProvider } from "./openAiCompatProvider.js";
export { loadLlmConfig } from "./config.js";
export type { LlmConfig, ResolvedProvider, ProviderKind } from "./config.js";
export { LlmError, LlmChainExhaustedError, ConfigError } from "./errors.js";
export type { LlmErrorKind } from "./errors.js";
export type {
  ChatRequest,
  ChatResponse,
  LlmMessage,
  LlmProvider,
  LlmRole,
  LlmToolSchema,
  LlmUsage,
  NormalizedToolCall,
} from "./types.js";

/** Build a fallback router from env: one provider + one token bucket per LLM_CHAIN slot. */
export function buildLlmRouter(env: NodeJS.ProcessEnv = process.env, logger?: LlmLogger): LlmRouter {
  const config = loadLlmConfig(env);
  const entries: RouterEntry[] = config.chain.map((pc) => ({
    provider: createProvider(pc, config.timeoutMs),
    bucket: new TokenBucket({ rpm: pc.rpm }),
  }));
  return new LlmRouter(entries, logger);
}

export function createProvider(pc: ResolvedProvider, timeoutMs: number): LlmProvider {
  const cfg = {
    name: pc.name,
    model: pc.model,
    apiKey: pc.apiKey,
    baseUrl: pc.baseUrl,
    timeoutMs,
  };
  return pc.kind === "gemini" ? new GeminiProvider(cfg) : new OpenAiCompatProvider(cfg);
}
