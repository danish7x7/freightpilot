import { randomUUID } from "node:crypto";
import type { LlmMessage, LlmRouter } from "../llm/index.js";
import type { Tool, ToolClients, ToolResult } from "../tools/index.js";
import { runAgentTurn, type AgentTurnResult, type RunAgentTurnArgs } from "../loop/agentLoop.js";
import { propose, type CardState, type GateDeps, type GateLogger } from "../gate/gateService.js";
import { composeMessages, SYSTEM_PROMPT } from "../prompt/systemPrompt.js";

/**
 * The L5 turn handler (§6.2/§6.3) — the FIRST HTTP surface that drives the agent tool loop and
 * the FIRST production caller of gateService.propose(). It runs one turn (extract → validate →
 * retry → fallback), then maps the loop's inert outcome to a wire reply. When the loop yields the
 * create_booking proposal, THIS is where a confirmation token is minted — proposing, not executing;
 * nothing books until the user redeems that token (the load-bearing invariant, ADR-0009).
 *
 * D14 scope (Option A — the seam, not the prompt): the loop runs for real, but with NO system
 * prompt and NO conversation persistence. The system prompt itself lands in a separate L5 prompt PR
 * (prompts are code — CLAUDE.md); this file now obtains its messages from the shared composer
 * (`prompt/systemPrompt.ts`, condition C1), so when that prompt arrives it reaches this path and the
 * eval path together. conversation_id is minted-and-echoed so the client can thread turns, but
 * nothing about the conversation is stored beyond the confirmation row's provenance.
 */

/** The wire reply — mirrors contracts/agent.openapi.yaml TurnResponse (agent-service is the SERVER
 * of that spec; it hand-writes these shapes to match it, it does not generate a client from it). */
export type TurnReply =
  | { kind: "text"; conversation_id: string; text: string }
  | { kind: "form_fallback"; conversation_id: string; reason: string; validation_errors?: string[] }
  | { kind: "tool"; conversation_id: string; tool: string; result: ToolResult }
  | { kind: "proposal"; conversation_id: string; token: string; card: CardState };

/** The loop function, injectable so tests can drive each arm without a live provider. Defaults to
 * the real runAgentTurn (guardian: "the real loop, not a stub"). */
export type LoopFn = (args: RunAgentTurnArgs) => Promise<AgentTurnResult>;

export interface TurnDeps {
  /** Gate deps (db, booking) — propose() persists the confirmation and mints the token. */
  gate: GateDeps;
  router: LlmRouter;
  tools: readonly Tool[];
  clients: ToolClients;
  /** Test seam; real runAgentTurn in production. */
  runLoop?: LoopFn;
  logger?: GateLogger;
}

export interface TurnInput {
  conversationId?: string;
  message: string;
}

const noopLogger: GateLogger = { info: () => {}, warn: () => {} };

export async function runTurn(deps: TurnDeps, input: TurnInput): Promise<TurnReply> {
  const conversationId = input.conversationId ?? randomUUID();
  const logger = deps.logger ?? noopLogger;

  // Messages come from the SHARED composer (condition L5-C1), the same function the eval runner
  // drives, so the suite can never measure a different message list than production sends. At v1
  // this is [{role:"system", content: the prompt}, {role:"user", ...}]; the eval path builds the
  // identical shape from the identical constant, which is what closes hazard H1.
  const messages: LlmMessage[] = composeMessages(SYSTEM_PROMPT, [
    { role: "user", content: input.message },
  ]);

  const loop = deps.runLoop ?? runAgentTurn;
  const result = await loop({
    router: deps.router,
    tools: deps.tools,
    clients: deps.clients,
    messages,
    logger,
  });

  switch (result.kind) {
    case "text":
      return { kind: "text", conversation_id: conversationId, text: result.text };
    case "form_fallback":
      return {
        kind: "form_fallback",
        conversation_id: conversationId,
        reason: result.reason,
        ...(result.validationErrors ? { validation_errors: result.validationErrors } : {}),
      };
    case "tool": {
      const execution = result.execution;
      if (execution.kind === "proposal") {
        // The ONLY place a token is minted (propose()'s first production caller). The token
        // rides ONLY in this response body; it is never logged (only the non-secret id is,
        // inside propose) and never persisted anywhere but the confirmations row.
        const { token, card } = await propose(deps.gate, execution.proposal, { conversationId });
        return { kind: "proposal", conversation_id: conversationId, token, card };
      }
      return { kind: "tool", conversation_id: conversationId, tool: result.tool, result: execution.result };
    }
  }
}
