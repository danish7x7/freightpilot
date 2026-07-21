/**
 * One-time fixture recorder — makes REAL provider calls and saves their raw wire
 * responses so unit tests can replay them with zero live calls in CI.
 *
 *   pnpm record:fixtures        (sets RECORD_FIXTURES=1)
 *
 * This file lives in scripts/ — NOT under test/ — so the vitest glob never picks it
 * up and CI never runs it. It is manual and env-gated by design.
 *
 * It records the (a) plain-text and (b) tool-call cases per provider in LLM_CHAIN.
 * The (c) 429 rate-limit fixtures are hand-authored (a real 429 can't be provoked on
 * demand) and already committed under test/fixtures/<provider>/rate-limit-429.json.
 *
 * Requires real keys in the environment (services/agent/.env — gitignored). Only the
 * response BODY + status is written; request auth headers/keys are never persisted.
 *
 * Success bodies are SANITIZED before writing (sanitizeBody): we keep only the fields
 * the adapter's normalizer actually reads and drop everything else. This matters for
 * more than tidiness — Gemini thinking models return an encrypted `thoughtSignature`
 * reasoning blob the adapter never consumes, and its base64 content trips secret
 * scanners as a false positive. Stripping it keeps committed fixtures minimal + clean.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProvider, loadLlmConfig } from "../src/llm/index.js";
import type { ProviderKind, ResolvedProvider } from "../src/llm/index.js";
import { TEXT_REQUEST, TOOLCALL_REQUEST } from "../test/fixtures/throwawayTool.js";

if (process.env.RECORD_FIXTURES !== "1") {
  console.error("Refusing to run: set RECORD_FIXTURES=1 (use `pnpm record:fixtures`).");
  process.exit(1);
}

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");

// Tee the raw wire response for the next call, without disturbing the provider.
let captured: { status: number; body: unknown } | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const res = await realFetch(input, init);
  const clone = res.clone();
  captured = { status: clone.status, body: await clone.json().catch(() => null) };
  return res;
};

function write(pc: ResolvedProvider, name: string): void {
  if (!captured) throw new Error(`no response captured for ${pc.name}/${name}`);
  // Only 2xx bodies are normalized (and thus sanitized); error bodies are read only for
  // their status, so pass them through untouched.
  const isSuccess = captured.status >= 200 && captured.status < 300;
  const body = isSuccess ? sanitizeBody(pc.kind, captured.body) : captured.body;
  const dir = join(fixturesDir, pc.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ status: captured.status, body }, null, 2) + "\n");
  console.log(`recorded ${pc.name}/${name}.json (status ${captured.status})`);
  captured = null;
}

// ---- Sanitizers: keep ONLY what each normalizer reads (see src/llm/*Provider.ts) ----

function sanitizeBody(kind: ProviderKind, body: unknown): unknown {
  return kind === "gemini"
    ? sanitizeGemini(body as GeminiWireBody)
    : sanitizeOpenAiCompat(body as OpenAiWireBody);
}

/** Gemini: keep candidates[].content.{parts(text|functionCall), role}, finishReason, usageMetadata token counts. */
function sanitizeGemini(body: GeminiWireBody) {
  const candidates = (body.candidates ?? []).map((c) => {
    const parts = (c.content?.parts ?? []).map((p): GeminiPart => {
      if (typeof p.text === "string") return { text: p.text };
      if (p.functionCall) {
        // Note: functionCall.id is dropped — the adapter synthesizes its own per-response id.
        return { functionCall: { name: p.functionCall.name, args: p.functionCall.args } };
      }
      return {};
    });
    const content: GeminiContent = { parts };
    if (c.content?.role !== undefined) content.role = c.content.role;
    const out: GeminiCandidate = { content };
    if (c.finishReason !== undefined) out.finishReason = c.finishReason;
    return out;
  });
  return {
    candidates,
    usageMetadata: {
      promptTokenCount: body.usageMetadata?.promptTokenCount,
      candidatesTokenCount: body.usageMetadata?.candidatesTokenCount,
    },
  };
}

/** OpenAI-schema (Groq/Cerebras): keep choices[].message.{role, content, tool_calls{id,function}}, finish_reason, usage token counts. */
function sanitizeOpenAiCompat(body: OpenAiWireBody) {
  const choices = (body.choices ?? []).map((ch) => {
    const m = ch.message ?? {};
    const message: OpenAiMessage = { content: m.content ?? null };
    if (m.role !== undefined) message.role = m.role;
    if (Array.isArray(m.tool_calls)) {
      message.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        function: { name: tc.function?.name, arguments: tc.function?.arguments },
      }));
    }
    const out: OpenAiChoice = { message };
    if (ch.finish_reason !== undefined) out.finish_reason = ch.finish_reason;
    return out;
  });
  return {
    choices,
    usage: {
      prompt_tokens: body.usage?.prompt_tokens,
      completion_tokens: body.usage?.completion_tokens,
    },
  };
}

// Structural views of the wire bodies — mirror the normalizers' reads.
interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
}
interface GeminiContent {
  parts: GeminiPart[];
  role?: string;
}
interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
}
interface GeminiWireBody {
  candidates?: { content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OpenAiMessage {
  role?: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}
interface OpenAiChoice {
  message: OpenAiMessage;
  finish_reason?: string;
}
interface OpenAiWireBody {
  choices?: {
    message?: { role?: string; content?: string | null; tool_calls?: OpenAiToolCall[] };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// ---- Record loop ----

const config = loadLlmConfig();
for (const pc of config.chain) {
  const provider = createProvider(pc, config.timeoutMs);
  console.log(`\n== ${pc.name} (${pc.model}) ==`);
  try {
    await provider.chat(TEXT_REQUEST);
    write(pc, "text");
  } catch (err) {
    console.error(`  text case failed:`, err);
  }
  try {
    await provider.chat(TOOLCALL_REQUEST);
    write(pc, "toolcall");
  } catch (err) {
    console.error(`  toolcall case failed:`, err);
  }
}

console.log("\nDone. 429 fixtures are hand-authored — not recorded here.");
