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
 * One provider class for every OpenAI-schema backend — Groq and Cerebras both speak
 * it; only baseUrl + model + key differ (all from config). No SDK — plain fetch.
 *
 * Deliberately never sends `response_format`: Cerebras rejects tools + response_format
 * together, so we prefer tool-calling and let the model return plain text otherwise
 * (§6.1 note). Cerebras also treats system/developer roles at "developer" level; we
 * send role "system" and rely on that server-side collapse.
 */
export interface OpenAiCompatProviderConfig {
  name: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export class OpenAiCompatProvider implements LlmProvider {
  readonly supportsTools = true;

  constructor(private readonly cfg: OpenAiCompatProviderConfig) {}

  get name(): string {
    return this.cfg.name;
  }
  get model(): string {
    return this.cfg.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const url = `${this.cfg.baseUrl}/chat/completions`;
    const json = await postJson(
      url,
      {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(this.toBody(req)),
      },
      this.cfg.name,
      this.cfg.timeoutMs,
    );
    return this.normalize(json);
  }

  private toBody(req: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: req.messages.map(toOpenAiMessage),
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }
    if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }
    return body;
  }

  private normalize(json: unknown): ChatResponse {
    const root = json as OpenAiResponse;
    const message = root?.choices?.[0]?.message;
    if (!message) {
      throw new LlmError("malformed", this.cfg.name, `${this.cfg.name} response had no choices`);
    }

    const toolCalls: NormalizedToolCall[] = (message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: parseArgs(tc.function.arguments, this.cfg.name),
    }));

    return {
      text: message.content ?? null,
      toolCalls,
      usage: {
        inputTokens: root.usage?.prompt_tokens ?? 0,
        outputTokens: root.usage?.completion_tokens ?? 0,
      },
      provider: this.cfg.name,
      model: this.cfg.model,
    };
  }
}

function toOpenAiMessage(m: LlmMessage): Record<string, unknown> {
  const msg: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.toolCalls?.length) {
    msg.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
    }));
  }
  if (m.role === "tool" && m.toolCallId) {
    msg.tool_call_id = m.toolCallId;
  }
  return msg;
}

function parseArgs(raw: string, provider: string): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (err) {
    // A tool call whose arguments aren't valid JSON is a provider/protocol fault, not
    // a transport hiccup — surface it, don't fall through to the next provider.
    throw new LlmError("malformed", provider, `tool_call arguments were not valid JSON`, undefined, {
      cause: err,
    });
  }
}

// Minimal structural view of the OpenAI-schema wire response we read.
interface OpenAiResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
