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
  /**
   * OPAQUE provider token that must be echoed back when this tool call is re-sent.
   *
   * Gemini thinking models issue a `thoughtSignature` on the part carrying a `functionCall`, and
   * REQUIRE it back on that part when the assistant turn is replayed into a later request. Omit it
   * and the API returns a NON-RETRYABLE 400 ("Function call is missing a thought_signature in
   * functionCall parts"), which the router surfaces rather than falling back, so the turn dies.
   * That is every retry the loop makes: `agentLoop` appends the assistant tool call to the
   * conversation and calls again.
   *
   * TREAT AS OPAQUE. Never log it, never branch on its value, never assert what it contains. The
   * only correctness property is that what came out of a response goes back into the next request
   * unchanged. Providers that do not issue one leave it undefined, and nothing else in the system
   * reads it.
   *
   * KNOWN LIMITATION, not currently guarded: a signature is only valid for the provider that
   * issued it, and this type does not record which one that was. `LlmRouter` falls back PER CALL,
   * not per turn (router.ts), so a turn where Gemini 429s, Groq serves the tool call, and Gemini
   * serves the retry echoes a `functionCall` part with no signature back to Gemini, producing the
   * same non-retryable 400 from the opposite direction. Rare (it needs a fallback and a recovery
   * inside one turn) and out of scope for L5, but it is real and nothing detects it. The fix, when
   * it is worth making, is to tag the issuing provider here and drop the field when the echo goes
   * somewhere else. See ADR-0013.
   */
  thoughtSignature?: string;
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
  /** Which provider served, after any fallback. */
  provider: string;
  /**
   * The model identifier we ASKED FOR: the configured value from `LLM_CHAIN`, echoed back. For
   * Gemini this is `gemini-flash-latest`, an ALIAS, so it says nothing about what actually ran.
   */
  model: string;
  /**
   * The model the provider says actually ANSWERED, read off the response body.
   *
   * `model` records the request, this records the reply, and the gap between them is the whole
   * point. ADR-0007 pins the primary to `gemini-flash-latest`, an alias whose backing model has
   * already rotated once (to a thinking model) with no line changing in this repo. Amendment A5
   * therefore requires that a primary or alias change be RE-RECORDED, not merely re-run.
   *
   * Precisely what this buys, because the stronger claim is false: it makes a rotation AUDITABLE,
   * not automatically DETECTED. Recording the resolved version means a rotation is visible in the
   * committed bytes and in `served_models` on the scorecard, where before it was invisible in
   * principle. It does NOT make A5 self-enforcing: `ReplayProvider`'s record path short-circuits on
   * an existing fixture, so if the prompt is unchanged the keys are unchanged and a re-record makes
   * zero live calls and refreshes nothing. Re-baselining after a rotation still requires purging
   * the recordings first. See `evals/runner/src/recordings/README.md`.
   *
   * OPTIONAL because not every provider resolves. Measured 2026-07-31 with one live call: Groq
   * ECHOES the requested id (`llama-3.3-70b-versatile` in, the same string out), so for the current
   * chain the Groq value carries no information beyond `model`. Recorded anyway, so the asymmetry
   * is visible in the bytes rather than assumed, and so a future provider that DOES resolve is
   * captured without another envelope change.
   */
  servedModel?: string;
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
