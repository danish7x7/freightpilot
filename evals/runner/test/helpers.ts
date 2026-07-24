import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOLS, type ChatResponse, type LlmMessage } from "../src/agent.js";
import { recordingKey } from "../src/recordingKey.js";

/**
 * Test helpers — synthesize the SAME kind of recording the runner replays, keyed exactly as
 * run.ts will key it (single-entry router → tools = TOOLS.map(t => t.schema)). Hermetic: these
 * tests make zero API calls and never touch the committed v0-none recordings.
 */
export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `evals-${prefix}-`));
}

export function toolSchemas(): { name: string; description?: string; parameters: Record<string, unknown> }[] {
  return TOOLS.map((t) => t.schema);
}

/** The exact ChatRequest key the loop produces for a single user message + the full TOOLS set. */
export function keyForMessage(message: string): string {
  const messages: LlmMessage[] = [{ role: "user", content: message }];
  return recordingKey({ messages, tools: toolSchemas() });
}

export function keyForMessages(messages: LlmMessage[]): string {
  return recordingKey({ messages, tools: toolSchemas() });
}

/** Write a recording (a ChatResponse, or an `{eval_provider_error}` envelope for error tests). */
export function writeRecording(dir: string, key: string, res: ChatResponse | Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(res, null, 2) + "\n");
}

export function toolCallResponse(name: string, args: Record<string, unknown>): ChatResponse {
  return {
    text: null,
    toolCalls: [{ id: "call_0", name, arguments: args }],
    usage: { inputTokens: 10, outputTokens: 5 },
    provider: "test",
    model: "test",
  };
}

export function textResponse(text: string): ChatResponse {
  return {
    text,
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5 },
    provider: "test",
    model: "test",
  };
}
