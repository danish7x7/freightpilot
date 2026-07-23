// Data hooks over the agent contract. Types come straight from the generated client (§5 "do not
// fork") and every request goes through openapi-fetch (no hand-built URLs). Three surfaces:
//   useTurn        — POST /api/v1/turns (chat; may return a proposal + secret token)
//   useRedeem      — POST /api/v1/confirmations/{token} (the single user-click that executes)
//   useConfirmationCard — GET /api/v1/confirmations/{token} (poll the 202 in_progress case)
//
// Token containment (D14 Condition 3): the secret token is passed as a mutation/query VARIABLE and
// held in component memory — it is NEVER a query-cache key (keys use the non-secret confirmation_id)
// and never a navigable URL. GET does not re-emit it, so refetching the card is safe.
import { useMutation, useQuery } from "@tanstack/react-query";
import { agentClient, AgentApiError } from "./agent";
import type { components } from "./agent.gen";

export type TurnResponse = components["schemas"]["TurnResponse"];
export type TurnProposalReply = components["schemas"]["TurnProposalReply"];
export type CardState = components["schemas"]["CardState"];
export type RedeemConfirmed = components["schemas"]["RedeemConfirmed"];
export type RedeemHeldUnconfirmed = components["schemas"]["RedeemHeldUnconfirmed"];
export type RedeemInProgress = components["schemas"]["RedeemInProgress"];
/** The three-arm redeem body (200 confirmed|held_unconfirmed, 202 in_progress). Discriminated on
 * `status` — authoritative in the body, so the UI never needs the raw HTTP status code. */
export type RedeemResult = RedeemConfirmed | RedeemHeldUnconfirmed | RedeemInProgress;

export interface TurnInput {
  conversationId?: string;
  message: string;
}

/** Bounded-polling policy for a 202 in_progress redeem (D14 Condition 5). */
export const POLL_INTERVAL_MS = 1500;
export const POLL_MAX_MS = 20_000;

/** POST /api/v1/turns — one agent turn. A `proposal` reply carries the secret token in its body. */
export function useTurn() {
  return useMutation<TurnResponse, AgentApiError, TurnInput>({
    mutationFn: async ({ conversationId, message }) => {
      const { data, error } = await agentClient.POST("/api/v1/turns", {
        body: { conversation_id: conversationId, message },
      });
      if (error || !data) throw new AgentApiError(error);
      return data;
    },
  });
}

/**
 * POST /api/v1/confirmations/{token} — REDEEM: the one path from proposal to booking (§6.3.2).
 * A mutation, NOT a query: a queryFn would refetch on window-focus/reconnect and fire phantom
 * redeems. NO retry (D14 Condition 6) — mutations default retry:0 and we never raise it, so one
 * click can only ever be one redeem. The server is transactionally single-use regardless; this
 * keeps the UI from *fabricating* a second attempt.
 */
export function useRedeem() {
  return useMutation<RedeemResult, AgentApiError, string>({
    mutationFn: async (token) => {
      const { data, error } = await agentClient.POST("/api/v1/confirmations/{token}", {
        params: { path: { token } },
      });
      if (error || !data) throw new AgentApiError(error);
      return data;
    },
  });
}

/**
 * GET /api/v1/confirmations/{token} — the non-secret card. Used to POLL a 202 in_progress redeem
 * to resolution. `enabled` + `refetchInterval` are caller-controlled so the component can BOUND the
 * polling (D14 Condition 5): the crashed-winner reaper is deferred, so in_progress can be permanent
 * — the caller stops polling after a cap and shows a terminal "still processing" state, never an
 * unbounded spinner. The token is a fetch VARIABLE; the cache key is the non-secret confirmation_id.
 */
export function useConfirmationCard(args: {
  confirmationId: string;
  token: string;
  enabled: boolean;
  /** Wall-clock time (ms) after which polling STOPS even if unresolved — the hard cap. */
  deadline: number;
}) {
  return useQuery<CardState, AgentApiError>({
    queryKey: ["confirmation-card", args.confirmationId],
    enabled: args.enabled,
    // Stop as soon as the card settles (final_status set) or the deadline passes — never spin
    // forever. The function form re-decides after every poll, so it is self-terminating.
    refetchInterval: (query) => {
      if (query.state.data && query.state.data.final_status !== null) return false;
      if (Date.now() >= args.deadline) return false;
      return POLL_INTERVAL_MS;
    },
    queryFn: async () => {
      const { data, error } = await agentClient.GET("/api/v1/confirmations/{token}", {
        params: { path: { token: args.token } },
      });
      if (error || !data) throw new AgentApiError(error);
      return data;
    },
  });
}
