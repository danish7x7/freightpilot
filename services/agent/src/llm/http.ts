import { LlmError } from "./errors.js";

/**
 * Shared HTTP transport for providers. Uses the Node 22 global `fetch` (no SDKs) so
 * tests can intercept at the HTTP boundary (undici MockAgent) and exercise the REAL
 * normalization + error classifier.
 *
 * The error classifier is the router's fallback allowlist, applied here once:
 *   429 → rate_limit, 5xx → server, other 4xx → client (bug), abort → timeout,
 *   fetch throw → network, bad 200 body → malformed (bug).
 */
export async function postJson(
  url: string,
  init: { headers: Record<string, string>; body: string },
  provider: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new LlmError("timeout", provider, `${provider} timed out after ${timeoutMs}ms`, undefined, {
        cause: err,
      });
    }
    throw new LlmError("network", provider, `network error calling ${provider}`, undefined, {
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw classifyHttpError(res.status, provider, await safeText(res));
  }

  try {
    return await res.json();
  } catch (err) {
    throw new LlmError("malformed", provider, `invalid JSON body from ${provider}`, res.status, {
      cause: err,
    });
  }
}

function classifyHttpError(status: number, provider: string, body: string): LlmError {
  const detail = truncate(body);
  if (status === 429) {
    return new LlmError("rate_limit", provider, `${provider} rate limited (429): ${detail}`, status);
  }
  if (status >= 500) {
    return new LlmError("server", provider, `${provider} server error (${status}): ${detail}`, status);
  }
  // Everything else non-ok (any 4xx, plus an unexpected 3xx that escaped redirect-follow)
  // is a bug on our side, not a transient transport fault — a bug. Do NOT fall through.
  return new LlmError("client", provider, `${provider} client error (${status}): ${detail}`, status);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function truncate(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
