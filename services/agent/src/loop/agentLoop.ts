import type { z } from "zod";
import type { LlmMessage } from "../llm/index.js";
import type { LlmRouter } from "../llm/index.js";
import type { Tool, ToolClients, ToolExecution } from "../tools/index.js";

/**
 * The agent tool loop (§6.2 / §6.3.1): extract → Zod-validate → ONE retry with the errors
 * fed back → manual-form fallback. The LLM extracts structured params as a tool call; we
 * validate them with the tool's Zod schema; on failure we hand the errors back for a single
 * retry; if it still won't validate we surface `form_fallback` so the UI drops the user into
 * the manual form. Runs on the L1 router (buildLlmRouter) — provider-agnostic.
 *
 * Not in scope here (later layers): confirmation gate / token / booking execution (L3),
 * telemetry persistence + prompt versioning (L4), chat UI (L5). We LOG raw usage + per-tool
 * latency so L4 has the data, but persist nothing.
 */

const MAX_ATTEMPTS = 2; // initial extraction + exactly one retry.

/** Minimal logger surface; Fastify's logger satisfies it. Usage/latency logged, never stored. */
export interface AgentLogger {
  info(data: Record<string, unknown>): void;
  warn(data: Record<string, unknown>): void;
}
const noopLogger: AgentLogger = { info: () => {}, warn: () => {} };

export type AgentTurnResult =
  /** A tool ran: a live courier `service_result`, or create_booking's inert `proposal`. */
  | { kind: "tool"; tool: string; execution: ToolExecution }
  /** The model answered in text (e.g. a clarifying question) — no tool call. */
  | { kind: "text"; text: string }
  /** Extraction/validation failed after the retry — hand off to the manual form. */
  | { kind: "form_fallback"; reason: string; validationErrors?: string[] };

export interface RunAgentTurnArgs {
  router: LlmRouter;
  tools: readonly Tool[];
  clients: ToolClients;
  /** Full conversation so far (system + user turns). The loop appends the retry turns itself. */
  messages: LlmMessage[];
  logger?: AgentLogger;
}

export async function runAgentTurn(args: RunAgentTurnArgs): Promise<AgentTurnResult> {
  const { router, tools, clients, logger = noopLogger } = args;
  const toolSchemas = tools.map((t) => t.schema);
  const byName = new Map(tools.map((t) => [t.name, t]));

  const convo: LlmMessage[] = [...args.messages];
  let lastErrors: string[] | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    const res = await router.chat({ messages: convo, tools: toolSchemas });
    // L4 carry: log raw provider usage as-returned + latency; persist nothing.
    logger.info({
      event: "llm_extract",
      attempt,
      provider: res.provider,
      model: res.model,
      usage: res.usage,
      latencyMs: Date.now() - t0,
    });

    const call = res.toolCalls[0];
    if (!call) {
      // No tool call — the model chose to answer/clarify in text. Not a failure.
      return { kind: "text", text: res.text ?? "" };
    }

    const tool = byName.get(call.name);
    if (tool) {
      const parsed = tool.validate.safeParse(call.arguments);
      if (parsed.success) {
        return { kind: "tool", tool: tool.name, execution: await execute(tool, parsed.data, clients, logger) };
      }
      lastErrors = formatIssues(parsed.error);
    } else {
      lastErrors = [`unknown tool "${call.name}"; valid tools: ${tools.map((t) => t.name).join(", ")}`];
    }

    logger.warn({ event: "extract_invalid", attempt, tool: call.name, errors: lastErrors });

    if (attempt < MAX_ATTEMPTS) {
      // Feed the validation errors back for exactly one retry (echo the bad call, then a
      // tool-role correction so the model sees precisely what to fix).
      convo.push(
        { role: "assistant", content: res.text ?? "", toolCalls: [call] },
        {
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: `Your ${call.name} call failed validation: ${lastErrors.join("; ")}. Call the tool again with corrected arguments.`,
        },
      );
    }
  }

  // Initial extraction + one retry both failed → manual form.
  logger.warn({ event: "form_fallback", errors: lastErrors });
  return { kind: "form_fallback", reason: "validation_failed_after_retry", validationErrors: lastErrors };
}

async function execute(
  tool: Tool,
  validatedArgs: unknown,
  clients: ToolClients,
  logger: AgentLogger,
): Promise<ToolExecution> {
  const t0 = Date.now();
  const execution = await tool.execute(validatedArgs, clients);
  logger.info({
    event: "tool_executed",
    tool: tool.name,
    outcome: execution.kind,
    latencyMs: Date.now() - t0,
    ...(execution.kind === "service_result"
      ? { status: execution.result.status, ok: execution.result.ok }
      : {}),
  });
  return execution;
}

function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}
