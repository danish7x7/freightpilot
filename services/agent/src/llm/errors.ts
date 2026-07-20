/**
 * Typed LLM adapter errors.
 *
 * The router's fallback allowlist is defined here, in ONE place: it falls through
 * to the next provider ONLY for retryable transport failures (429 / 5xx / timeout /
 * network). Everything else — a malformed request (4xx) or a garbled 200 body — is a
 * bug that must surface, never be masked by silently trying the next provider.
 */

export type LlmErrorKind =
  | "rate_limit" // HTTP 429
  | "server" // HTTP 5xx
  | "timeout" // request aborted past the deadline
  | "network" // fetch threw (DNS, connection reset, …)
  | "client" // non-429 4xx — a bug in our request, do NOT fall through
  | "malformed"; // 200 with an unparseable/unexpected body — do NOT fall through

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set<LlmErrorKind>([
  "rate_limit",
  "server",
  "timeout",
  "network",
]);

/** A failure from a single provider call. `retryable` drives the router's fallback decision. */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    readonly provider: string,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

/** Every provider in the chain failed (all retryable), or the chain was empty. */
export class LlmChainExhaustedError extends Error {
  constructor(readonly attempts: { provider: string; error: LlmError }[]) {
    super(
      `All LLM providers exhausted (${
        attempts.map((a) => `${a.provider}:${a.error.kind}`).join(", ") || "none configured"
      })`,
    );
    this.name = "LlmChainExhaustedError";
  }
}

/** Misconfiguration surfaced at startup (bad LLM_CHAIN, missing key, …). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
