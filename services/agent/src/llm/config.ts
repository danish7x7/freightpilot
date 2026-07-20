import { z } from "zod";
import { ConfigError } from "./errors.js";

/**
 * Env-driven LLM adapter config (MASTER_PLAN §6.1). Everything is config: the
 * ordered fallback chain, model IDs, keys, per-provider pacing, and the timeout.
 * Switching provider/model is a redeploy with new env — zero code change.
 *
 * LLM_CHAIN is a comma-separated list of `provider:model` pairs (matches the root
 * .env.example and §6.1 exactly), e.g.:
 *   LLM_CHAIN=gemini:gemini-2.5-flash,groq:llama-3.3-70b-versatile,cerebras:llama-3.3-70b
 */

export type ProviderKind = "gemini" | "openai-compat";

/** A fully-resolved provider slot in the chain — everything a provider needs to run. */
export interface ResolvedProvider {
  name: string; // registry key: "gemini" | "groq" | "cerebras"
  kind: ProviderKind;
  model: string; // from LLM_CHAIN
  apiKey: string;
  baseUrl: string;
  rpm: number; // free-tier requests/min, drives the token bucket
}

export interface LlmConfig {
  chain: ResolvedProvider[];
  timeoutMs: number;
}

interface RegistryEntry {
  kind: ProviderKind;
  baseUrl: string;
  keyEnv: string;
  rpmEnv: string;
  defaultRpm: number;
}

/**
 * The only providers we know how to build. Base URLs are pinned here (not env) so a
 * typo can't silently point at the wrong host; model/key/rpm remain env-driven.
 * Groq and Cerebras share OpenAiCompatProvider — same class, different base URL.
 */
const REGISTRY: Record<string, RegistryEntry> = {
  gemini: {
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    keyEnv: "GEMINI_API_KEY",
    rpmEnv: "GEMINI_RPM",
    defaultRpm: 10, // Gemini free tier ~10 RPM (§6.1)
  },
  groq: {
    kind: "openai-compat",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    rpmEnv: "GROQ_RPM",
    defaultRpm: 30, // Groq free tier ~30 RPM (§6.1)
  },
  cerebras: {
    kind: "openai-compat",
    baseUrl: "https://api.cerebras.ai/v1",
    keyEnv: "CEREBRAS_API_KEY",
    rpmEnv: "CEREBRAS_RPM",
    defaultRpm: 30,
  },
};

const positiveInt = z.coerce.number().int().positive();

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const raw = env.LLM_CHAIN?.trim();
  if (!raw) {
    throw new ConfigError(
      "LLM_CHAIN is required (e.g. gemini:gemini-2.5-flash,groq:llama-3.3-70b-versatile)",
    );
  }

  const chain = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => resolveEntry(pair, env));

  if (chain.length === 0) {
    throw new ConfigError("LLM_CHAIN parsed to an empty chain");
  }

  return { chain, timeoutMs: parsePositiveInt(env.LLM_TIMEOUT_MS, 8000, "LLM_TIMEOUT_MS") };
}

function resolveEntry(pair: string, env: NodeJS.ProcessEnv): ResolvedProvider {
  const idx = pair.indexOf(":");
  if (idx <= 0 || idx >= pair.length - 1) {
    throw new ConfigError(`Malformed LLM_CHAIN entry "${pair}" — expected provider:model`);
  }
  const name = pair.slice(0, idx).trim();
  const model = pair.slice(idx + 1).trim();

  const reg = REGISTRY[name];
  if (!reg) {
    throw new ConfigError(
      `Unknown provider "${name}" in LLM_CHAIN — known: ${Object.keys(REGISTRY).join(", ")}`,
    );
  }

  const apiKey = env[reg.keyEnv]?.trim();
  if (!apiKey) {
    throw new ConfigError(`${reg.keyEnv} is required for provider "${name}" in LLM_CHAIN`);
  }

  return {
    name,
    kind: reg.kind,
    model,
    apiKey,
    baseUrl: reg.baseUrl,
    rpm: parsePositiveInt(env[reg.rpmEnv], reg.defaultRpm, reg.rpmEnv),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = positiveInt.safeParse(value);
  if (!parsed.success) {
    throw new ConfigError(`${label} must be a positive integer, got "${value}"`);
  }
  return parsed.data;
}
