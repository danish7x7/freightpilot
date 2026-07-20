/**
 * Normalized LLM adapter types (agent-phase L1 / global L5, MASTER_PLAN §6.1).
 *
 * ONE internal shape the agent loop (L2) will see, regardless of provider. Each
 * provider maps its own wire format to/from these types; nothing above the adapter
 * knows whether Gemini, Groq, or Cerebras served the request.
 */

/** Message roles. Cerebras collapses system/developer to "developer"; providers map this internally. */
export type LlmRole = "system" | "user" | "assistant" | "tool";

/** A single conversation message in normalized form. */
export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** For assistant turns that requested tools (round-trips the normalized shape back to the provider). */
  toolCalls?: NormalizedToolCall[];
  /** For role: "tool" results — which call this responds to, and the tool's name. */
  toolCallId?: string;
  name?: string;
}

/** A tool the model may call. `parameters` is a JSON Schema object, passed through per provider. */
export interface LlmToolSchema {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

/** A tool call the model emitted, normalized to one shape across providers. */
export interface NormalizedToolCall {
  /** Provider call id; synthesized for Gemini (which does not send one). */
  id: string;
  name: string;
  /** Parsed JSON arguments (OpenAI sends a JSON string; Gemini sends an object — both land here parsed). */
  arguments: Record<string, unknown>;
}

/** Token accounting from the provider's response. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatRequest {
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  temperature?: number;
}

export interface ChatResponse {
  /** Assistant text, or null when the turn was purely tool calls. */
  text: string | null;
  /** Normalized tool calls; empty when the model returned only text. */
  toolCalls: NormalizedToolCall[];
  usage: LlmUsage;
  /** Which provider/model actually served (after any fallback). */
  provider: string;
  model: string;
}

/**
 * A single LLM backend. Pure transport + normalization — no pacing, no fallback
 * (those live in the router). One `chat()` call maps to one HTTP request.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools: boolean;
  chat(req: ChatRequest): Promise<ChatResponse>;
}
