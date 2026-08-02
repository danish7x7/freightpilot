import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LlmError, type ChatRequest, type ChatResponse, type LlmErrorKind, type LlmProvider, type NormalizedToolCall } from "./agent.js";
import { recordingKey } from "./recordingKey.js";

/**
 * A recorded provider ERROR. Both providers reject some promptless turns with a non-retryable
 * 400 — Gemini rejects the tool SCHEMA (`exclusiveMinimum`); Groq server-side-validates the
 * model's tool CALL and 400s `tool_use_failed` on schema-invalid args. Those are REAL turn
 * outcomes, so we capture them and re-throw the same LlmError on replay: the eval reproduces the
 * production error path deterministically instead of hiding it. (See ADR-0011.)
 */
interface ErrorRecording {
  eval_provider_error: { kind: LlmErrorKind; provider: string; status: number | null; message: string };
}
function isErrorRecording(v: unknown): v is ErrorRecording {
  return Boolean(v && typeof v === "object" && "eval_provider_error" in (v as object));
}

/**
 * A replay MISS — no committed recording for a request. A DEDICATED type (not a plain Error) so
 * the scorer can tell it apart from a legitimately-replayed provider `LlmError`: a miss is a HARD
 * error that must abort the run with a non-zero exit (never a soft, non-gating per-case fail —
 * that would let an un-exercised case ride through CI green). See score.ts's catch blocks.
 */
export class ReplayMissError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayMissError";
  }
}

/**
 * The ReplayProvider — an `LlmProvider` (llm/types.ts:66) that serves committed recordings in
 * CI and captures new ones in manual record mode (§3). It is composed INSIDE the real LlmRouter
 * (run.ts) so pacing/fallback wrapping matches production; the router adds pacing, not response
 * shaping (guardian Q3).
 *
 * Replay (default, CI): compute the key from the ChatRequest, return the recorded ChatResponse.
 *   A MISS is a HARD ERROR — never a silent fall-through to a live call ($0 CI, Prime Directive 4).
 *
 * Record (EVAL_RECORD=1, manual, NEVER in PR CI): delegate to the REAL inner provider (built via
 *   createProvider so recordings reflect real normalization), then persist the NORMALIZED
 *   ChatResponse only. We record at the ChatResponse seam, above the wire — so there is no auth
 *   header or API key to leak (those live below normalization). We still apply the record-fixtures
 *   discipline: write ONLY the known normalized fields, nothing else, and pin synthesized
 *   tool-call ids so re-records don't churn the committed files.
 *
 * ON `thoughtSignature`, WHICH THIS COMMENT USED TO LIST AS A THING THAT CANNOT LEAK HERE.
 *
 * That was true and is no longer. It lived below normalization, so recording above the wire
 * dropped it for free. As of 2026-08-02 it is a field ON `NormalizedToolCall`, because Gemini
 * thinking models REQUIRE it echoed back and the loop's retry path 400s without it. So the
 * question "strip it from recordings, or keep it" became live, and the answer is FORCED rather
 * than chosen:
 *
 *   `recordingKey` hashes `req.messages`. On a retry the loop appends the assistant tool call to
 *   the conversation, so the signature is INSIDE the material the second call's key is computed
 *   from. Strip it from the recording and replay rebuilds that assistant turn without it, hashes
 *   different bytes, and MISSES its own committed fixture. A stripped set could not replay a
 *   multi-turn tool conversation at all.
 *
 * So it is preserved, deliberately, and the DoD is byte-for-byte: the request a replayed retry
 * builds is identical to the one a live retry builds. Anything less reintroduces the defect this
 * whole layer exists to prevent, where the eval path and the production path diverge silently.
 *
 * It is not a credential. It is opaque model-issued state scoped to one response, it carries no
 * account authority, and possessing one grants nothing. It stays out of logs (nothing logs
 * `toolCalls`), and no test asserts its VALUE — only that it round-trips. The residual exposure a
 * reviewer should weigh is that it is an encoded trace of model reasoning and it lands in a
 * committed fixture; that is accepted here because these are synthetic freight prompts with no
 * user or customer data in them.
 */
export type ReplayMode = "replay" | "record";

export interface ReplayProviderOptions {
  mode: ReplayMode;
  recordingsDir: string;
  /** The real provider to delegate to in record mode. Required iff mode === "record". */
  inner?: LlmProvider;
}

export class ReplayProvider implements LlmProvider {
  readonly name = "replay";
  readonly model: string;
  readonly supportsTools = true;

  constructor(private readonly opts: ReplayProviderOptions) {
    this.model = opts.inner?.model ?? "replay";
    if (opts.mode === "record" && !opts.inner) {
      throw new Error("ReplayProvider record mode requires a real `inner` provider");
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const key = recordingKey(req);
    const file = join(this.opts.recordingsDir, `${key}.json`);

    if (this.opts.mode === "record") {
      mkdirSync(this.opts.recordingsDir, { recursive: true });
      // Incremental capture: a case already recorded (success OR a frozen non-retryable error) is
      // NOT re-fetched, so repeated record passes converge on the gaps left by transient 429s
      // without re-hitting the free tier for cases already captured.
      if (existsSync(file)) {
        const prior: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (isErrorRecording(prior)) throw new LlmError(prior.eval_provider_error.kind, prior.eval_provider_error.provider, prior.eval_provider_error.message, prior.eval_provider_error.status ?? undefined);
        return prior as ChatResponse;
      }
      try {
        const live = await this.opts.inner!.chat(req);
        const sanitized = sanitizeResponse(live);
        writeFileSync(file, JSON.stringify(sanitized, null, 2) + "\n");
        return sanitized;
      } catch (err) {
        // Capture a deterministic, non-retryable provider error so replay reproduces this exact
        // turn outcome. Retryable errors (429/5xx/timeout/network) are transient — do NOT freeze
        // them into a recording; let them surface so the operator re-runs the capture.
        if (err instanceof LlmError && !err.retryable) {
          const rec: ErrorRecording = {
            eval_provider_error: { kind: err.kind, provider: err.provider, status: err.status ?? null, message: err.message },
          };
          writeFileSync(file, JSON.stringify(rec, null, 2) + "\n");
        }
        throw err;
      }
    }

    if (!existsSync(file)) {
      throw new ReplayMissError(
        `no recording for key ${key} (${describeRequest(req)}); run record mode (EVAL_RECORD=1) — ` +
          `CI never makes a live call, so a replay miss is a hard error, not a fallthrough`,
      );
    }
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (isErrorRecording(parsed)) {
      const e = parsed.eval_provider_error;
      throw new LlmError(e.kind, e.provider, e.message, e.status ?? undefined);
    }
    return parsed as ChatResponse;
  }
}

/**
 * Keep ONLY the normalized ChatResponse fields (mirrors sanitizeBody discipline in
 * scripts/record-fixtures.ts). Tool-call ids are synthesized by the adapter (Gemini sends none),
 * so we PIN them to `call_<i>` — they carry no meaning downstream (the loop only echoes them) and
 * pinning keeps committed recordings byte-stable across re-records.
 *
 * THIS IS AN ALLOWLIST, and that is the hazard: a field the adapter parses but this function does
 * not name is silently dropped at record time. It would look captured in the type and be absent
 * from every committed byte, which is the same class of defect as a label decoupled from what it
 * labels. `servedModel` is forwarded here for that reason, and a mutation test drops this line
 * specifically to prove the omission is loud rather than invisible.
 */
export function sanitizeResponse(res: ChatResponse): ChatResponse {
  return {
    text: res.text ?? null,
    // `thoughtSignature` is carried, not stripped: it is part of the key material for the NEXT
    // call in a retry chain, so a set without it cannot replay one. See the header comment.
    // Still an allowlist rebuild — the field is named explicitly, nothing is spread in.
    toolCalls: (res.toolCalls ?? []).map(
      (tc, i): NormalizedToolCall => ({
        id: `call_${i}`,
        name: tc.name,
        arguments: tc.arguments,
        ...(tc.thoughtSignature !== undefined ? { thoughtSignature: tc.thoughtSignature } : {}),
      }),
    ),
    usage: { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0 },
    provider: res.provider,
    model: res.model,
    servedModel: res.servedModel,
  };
}

/**
 * The DISTINCT served models across the committed recordings, sorted.
 *
 * A set rather than a scalar, deliberately. The v1 capture is budgeted to span more than one day
 * against a daily-capped free tier, so the alias can rotate PART WAY THROUGH it. A single string
 * would have to pick a winner and would therefore be false for some of the fixtures it claims to
 * describe, hiding the exact event this field exists to surface. A set of two is a loud, readable
 * signal that the capture is not homogeneous.
 *
 * Reads the WHOLE DIRECTORY rather than tracking which fixtures a given run consumed. In
 * replay/CI that is sound and equivalent: `fixtureCompleteness`'s orphan test forbids a fixture no
 * case claims, and it runs in the same CI job as `make evals`, so a divergent directory cannot
 * merge green. In RECORD mode nothing enforces it, and there the difference is live: a stale
 * orphan from a superseded key contributes to the union indistinguishably from a genuine
 * mid-capture rotation. Both show up as a two-element set, which is the signal this function
 * exists to make loud, so the operator meets the false positive during capture and before the
 * orphan test can speak. A two-element set during a capture means "look at the directory", not
 * "the alias rotated".
 *
 * Error envelopes are skipped explicitly. This is DEFENCE IN DEPTH rather than a load-bearing
 * branch: they persist {kind, provider, status, message} and never carried a model, so the
 * non-empty-string guard below would exclude them anyway. Deleting this line breaks no test.
 */
export function collectServedModels(recordingsDir: string): string[] {
  if (!existsSync(recordingsDir)) return [];
  const seen = new Set<string>();
  for (const file of readdirSync(recordingsDir)) {
    if (!file.endsWith(".json")) continue;
    const body: unknown = JSON.parse(readFileSync(join(recordingsDir, file), "utf8"));
    if (isErrorRecording(body)) continue;
    const served = (body as ChatResponse).servedModel;
    if (typeof served === "string" && served.length > 0) seen.add(served);
  }
  return [...seen].sort();
}

function describeRequest(req: ChatRequest): string {
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
  const snippet = (lastUser?.content ?? "").slice(0, 80).replace(/\s+/g, " ");
  return `last user: "${snippet}"`;
}
