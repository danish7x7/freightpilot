import { postJson } from "./http.js";
import { LlmError } from "./errors.js";
import type {
  ChatRequest,
  ChatResponse,
  LlmMessage,
  LlmProvider,
  NormalizedToolCall,
} from "./types.js";

/**
 * Gemini native API (generateContent). Maps our normalized shape to Gemini's
 * `contents` / `system_instruction` / `functionCall` wire format and back.
 * No SDK — plain fetch (see http.ts). Auth via the `x-goog-api-key` header, never
 * the URL, so it never lands in a fixture or log.
 */
export interface GeminiProviderConfig {
  name: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export class GeminiProvider implements LlmProvider {
  readonly supportsTools = true;

  constructor(private readonly cfg: GeminiProviderConfig) {}

  get name(): string {
    return this.cfg.name;
  }
  get model(): string {
    return this.cfg.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Model comes from operator env (LLM_CHAIN), and baseUrl is a pinned prefix, so
    // there is no injection path — encodeURIComponent is belt-and-suspenders.
    const url = `${this.cfg.baseUrl}/v1beta/models/${encodeURIComponent(this.cfg.model)}:generateContent`;
    const json = await postJson(
      url,
      {
        headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey },
        body: JSON.stringify(toGeminiBody(req)),
      },
      this.cfg.name,
      this.cfg.timeoutMs,
    );
    return this.normalize(json);
  }

  private normalize(json: unknown): ChatResponse {
    const root = json as GeminiResponse;
    const candidate = root?.candidates?.[0];
    if (!candidate?.content) {
      throw new LlmError(
        "malformed",
        this.cfg.name,
        "Gemini response had no candidate content",
      );
    }

    let text = "";
    const toolCalls: NormalizedToolCall[] = [];
    (candidate.content.parts ?? []).forEach((part, i) => {
      if (typeof part.text === "string") {
        text += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          // Gemini sends no call id — synthesize one from the part index. NOTE: this is
          // unique WITHIN a response, not across a conversation (two turns can both emit
          // call_0). L2 must not assume globally-unique ids; Gemini itself round-trips
          // tool results by function name, not id (see toGeminiContent below).
          id: `call_${i}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    });

    return {
      text: text.length > 0 ? text : null,
      toolCalls,
      usage: {
        inputTokens: root.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: root.usageMetadata?.candidatesTokenCount ?? 0,
      },
      provider: this.cfg.name,
      model: this.cfg.model,
    };
  }
}

function toGeminiBody(req: ChatRequest): Record<string, unknown> {
  const systemParts = req.messages
    .filter((m) => m.role === "system")
    .map((m) => ({ text: m.content }));
  const contents = req.messages.filter((m) => m.role !== "system").map(toGeminiContent);

  const body: Record<string, unknown> = { contents };
  if (systemParts.length > 0) {
    body.system_instruction = { parts: systemParts };
  }
  if (req.tools?.length) {
    body.tools = [
      {
        function_declarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }
  if (req.temperature !== undefined) {
    body.generationConfig = { temperature: req.temperature };
  }
  return body;
}

function toGeminiContent(m: LlmMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return {
      role: "user",
      parts: [{ functionResponse: { name: m.name ?? "tool", response: { content: m.content } } }],
    };
  }
  const parts: unknown[] = [];
  if (m.content) parts.push({ text: m.content });
  for (const tc of m.toolCalls ?? []) {
    parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
  }
  return { role: m.role === "assistant" ? "model" : "user", parts };
}

// Minimal structural view of the Gemini wire response we read.
interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }[];
    };
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}
