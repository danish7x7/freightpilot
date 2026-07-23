import { describe, expect, test, vi } from "vitest";
import type { AgentTurnResult } from "../../src/loop/agentLoop.js";
import type { LlmRouter } from "../../src/llm/index.js";
import type { ToolClients } from "../../src/tools/index.js";
import type { GateDeps } from "../../src/gate/gateService.js";
import { buildCreateBookingProposal } from "../../src/tools/proposal.js";

// Mock the gate: the proposal arm's ONLY side effect is propose() (mints a token + persists a row).
// Stubbing it lets us assert the wiring — that runTurn calls propose with the proposal and the
// conversation id — without a Postgres. The real DB mint is covered in confirmations.it.test.ts.
const proposeStub = vi.hoisted(() => vi.fn());
vi.mock("../../src/gate/gateService.js", () => ({ propose: proposeStub }));

// Imported AFTER the mock is registered.
const { runTurn } = await import("../../src/turn/turnService.js");

function deps(runLoop: (args: unknown) => Promise<AgentTurnResult>) {
  return {
    gate: { db: undefined as never, booking: undefined as never } as GateDeps,
    router: {} as LlmRouter,
    tools: [],
    clients: {} as ToolClients,
    runLoop: runLoop as never,
  };
}
const loop = (r: AgentTurnResult) => vi.fn(async () => r);

describe("runTurn — maps the four loop outcomes to wire replies", () => {
  test("text arm — mints and echoes a conversation_id when none is supplied", async () => {
    const reply = await runTurn(deps(loop({ kind: "text", text: "Which port?" })), {
      message: "book something",
    });
    expect(reply).toMatchObject({ kind: "text", text: "Which port?" });
    expect(reply.conversation_id).toMatch(/^[0-9a-f-]{36}$/); // a minted uuid
    expect(proposeStub).not.toHaveBeenCalled();
  });

  test("threads a supplied conversation_id through unchanged", async () => {
    const reply = await runTurn(deps(loop({ kind: "text", text: "ok" })), {
      conversationId: "conv-7",
      message: "hi",
    });
    expect(reply.conversation_id).toBe("conv-7");
  });

  test("form_fallback arm — carries reason + validation_errors", async () => {
    const reply = await runTurn(
      deps(loop({ kind: "form_fallback", reason: "bad args", validationErrors: ["origin: required"] })),
      { message: "x" },
    );
    expect(reply).toMatchObject({
      kind: "form_fallback",
      reason: "bad args",
      validation_errors: ["origin: required"],
    });
  });

  test("tool (service_result) arm — forwards the tool name + verbatim result", async () => {
    const result = { ok: true as const, status: 200, data: { rate_cards: [] } };
    const reply = await runTurn(
      deps(loop({ kind: "tool", tool: "search_rates", execution: { kind: "service_result", result } })),
      { message: "rates?" },
    );
    expect(reply).toMatchObject({ kind: "tool", tool: "search_rates", result });
    expect(proposeStub).not.toHaveBeenCalled();
  });

  test("proposal arm — calls propose(gate, proposal, {conversationId}) and returns its token+card", async () => {
    const proposal = buildCreateBookingProposal({ quote_id: "q1", shipper_ref: "PO-1" });
    const card = {
      confirmation_id: "c1",
      quote_id: "q1",
      shipper_ref: "PO-1",
      status: "pending",
      expires_at: new Date().toISOString(),
      booking_id: null,
      final_status: null,
    };
    proposeStub.mockResolvedValueOnce({ token: "T".repeat(43), card });

    const reply = await runTurn(
      deps(loop({ kind: "tool", tool: "create_booking", execution: { kind: "proposal", proposal } })),
      { conversationId: "conv-9", message: "book it" },
    );

    expect(reply).toMatchObject({ kind: "proposal", conversation_id: "conv-9", token: "T".repeat(43), card });
    // The token is minted server-side via propose; the loop never mints it.
    expect(proposeStub).toHaveBeenCalledTimes(1);
    const [, passedProposal, ctx] = proposeStub.mock.calls[0];
    expect(passedProposal).toBe(proposal);
    expect(ctx).toEqual({ conversationId: "conv-9" });
  });
});
