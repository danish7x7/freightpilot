import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeMessages, SYSTEM_PROMPT, TOOLS, type ChatResponse, type LlmMessage } from "../src/agent.js";
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

/**
 * The exact ChatRequest key the loop produces for a single user message + the full TOOLS set.
 *
 * Routes through the PRODUCTION composer for the same reason `score.ts` does (condition C1): a
 * helper that hand-builds the array is a third composition site. It would not diverge silently —
 * at PR B the key written here would stop matching the key `scoreCase` asks for, and every test
 * using it would fail on a ReplayMissError — but it WOULD break ~13 tests the day the prompt
 * lands, for no reason other than the helper not having been kept in step.
 */
export function keyForMessage(message: string): string {
  return keyForMessages([{ role: "user", content: message }]);
}

export function keyForMessages(conversation: LlmMessage[]): string {
  return recordingKey({
    messages: composeMessages(SYSTEM_PROMPT, conversation),
    tools: toolSchemas(),
  });
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
