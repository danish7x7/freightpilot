import { createHash } from "node:crypto";
import type { ChatRequest } from "./agent.js";
import { PROMPT_VERSION } from "./promptVersion.js";

/**
 * The determinism seam (§3). A recording key is a stable hash over the material that
 * determines the model's response: the conversation `messages`, the `tools` handed to it
 * (names + schemas), and the global `prompt_version`. Same request → same key → same
 * committed recording; a request the model has never seen → a MISS → a hard error (never a
 * silent live call).
 *
 * `prompt_version` is mixed in so the L5 prompt PR (which bumps PROMPT_VERSION and adds a
 * system prompt to `messages`) invalidates every v0-none key.
 */
export function recordingKey(req: ChatRequest): string {
  const material = {
    prompt_version: PROMPT_VERSION,
    messages: req.messages,
    // names + schemas only — the model's behaviour is a function of the tool contract it sees.
    tools: (req.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? null,
      parameters: t.parameters,
    })),
    // NB: ChatRequest.temperature is intentionally NOT keyed — the loop never sets it (it is
    // always undefined here). If a future caller varies temperature per request, add it here so
    // two requests differing only in temperature do not alias to the same recording.
  };
  return createHash("sha256").update(canonicalJson(material)).digest("hex");
}

/**
 * Deterministic JSON: object keys sorted recursively, arrays preserved in order. Used for both
 * the recording key and the scorecard body so `git diff` shows real change, not ordering noise.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeys((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}
