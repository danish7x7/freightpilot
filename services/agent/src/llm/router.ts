import { LlmChainExhaustedError, LlmError } from "./errors.js";
import type { TokenBucket } from "./tokenBucket.js";
import type { ChatRequest, ChatResponse, LlmProvider } from "./types.js";

/**
 * The LLM_CHAIN router (MASTER_PLAN §6.1). Tries providers in configured order,
 * pacing each through its own token bucket, and falls back to the next ONLY on a
 * retryable transport failure (429 / 5xx / timeout / network — see errors.ts).
 *
 * A non-retryable error (a 4xx bug, a malformed body) is rethrown immediately: it
 * would fail identically on every provider, so masking it by falling through would
 * just hide the bug. All providers exhausted → LlmChainExhaustedError (L2's UI then
 * tells the user to use the manual form).
 */
export interface RouterEntry {
  provider: LlmProvider;
  bucket: TokenBucket;
}

/** Just enough logger surface to emit fallback telemetry; Fastify's logger satisfies it. */
export interface LlmLogger {
  warn(data: Record<string, unknown>): void;
}

const noopLogger: LlmLogger = { warn: () => {} };

export class LlmRouter {
  constructor(
    private readonly entries: RouterEntry[],
    private readonly logger: LlmLogger = noopLogger,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const attempts: { provider: string; error: LlmError }[] = [];

    for (const { provider, bucket } of this.entries) {
      await bucket.acquire();
      try {
        return await provider.chat(req);
      } catch (err) {
        if (err instanceof LlmError && err.retryable) {
          this.logger.warn({
            fallback_used: true,
            provider: provider.name,
            kind: err.kind,
            status: err.status,
          });
          attempts.push({ provider: provider.name, error: err });
          continue;
        }
        // Non-retryable: a bug that would recur on every provider. Surface it.
        throw err;
      }
    }

    throw new LlmChainExhaustedError(attempts);
  }
}
