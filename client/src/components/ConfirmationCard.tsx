import { useEffect, useRef, useState } from "react";
import {
  useRedeem,
  useConfirmationCard,
  POLL_MAX_MS,
  type CardState,
  type RedeemResult,
} from "../api/agentHooks";
import { AgentApiError } from "../api/agent";

// The confirmation card — the demo moment of the load-bearing invariant: the agent PROPOSED
// (inert token + card), and only THIS explicit user click redeems the token and executes the
// booking (§6.3.2, ADR-0009). The token is held in memory here (a prop), never in a URL or a
// query-cache key (D14 Condition 3).
//
// Two response channels (D14 Condition 4): the redeem POST returns a 200/202 RedeemResult body
// (confirmed | held_unconfirmed | in_progress), while 4xx/5xx come back as an AgentApiError whose
// WIRE code (CONFIRMATION_EXPIRED, CONFIRMATION_NOT_FOUND, QUOTE_UNAVAILABLE,
// BOOKING_EXECUTION_FAILED) the card branches on.

type Tone = "success" | "warn" | "error";
interface Outcome {
  tone: Tone;
  title: string;
  detail?: string;
  bookingId?: string;
}

export function ConfirmationCard({ token, card }: { token: string; card: CardState }) {
  const redeem = useRedeem();

  // Synchronous re-entry guard: isPending only flips after a re-render, so two clicks in one tick
  // would both pass a state check. A ref blocks the second immediately (mirrors BookingPanel).
  const inFlight = useRef(false);

  // Once the redeem returns 202 in_progress, poll the card until it settles — bounded by a deadline.
  const [inProgressId, setInProgressId] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  // The deadline must FORCE a render even when polling has stopped: refetchInterval returning false
  // won't re-render the component, so without this timer the UI could sit on "Finishing…" forever.
  const [pollExhausted, setPollExhausted] = useState(false);

  const polling = inProgressId !== null;

  useEffect(() => {
    if (!polling) return;
    const t = setTimeout(() => setPollExhausted(true), POLL_MAX_MS);
    return () => clearTimeout(t);
  }, [polling]);

  const cardPoll = useConfirmationCard({
    confirmationId: inProgressId ?? card.confirmation_id,
    token,
    enabled: polling,
    deadline: deadline ?? 0,
  });

  async function onConfirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    redeem.reset();
    try {
      const result = await redeem.mutateAsync(token);
      if (result.status === "in_progress") {
        setInProgressId(result.confirmation_id);
        setDeadline(Date.now() + POLL_MAX_MS);
      }
    } catch {
      // Terminal errors are surfaced from redeem.error below (typed AgentApiError). Swallow the
      // rejection so the click handler produces no unhandled promise.
    } finally {
      inFlight.current = false;
    }
  }

  // ---- Resolved states, in priority order --------------------------------------------------

  // 1. A settled redeem body (confirmed | held_unconfirmed).
  if (redeem.data && redeem.data.status !== "in_progress") {
    return <OutcomeView outcome={fromRedeem(redeem.data)} />;
  }

  // 2. A terminal redeem error (4xx/5xx envelope), keyed on the wire code.
  if (redeem.error) {
    return <OutcomeView outcome={fromError(redeem.error)} />;
  }

  // 3. Polling an in_progress redeem.
  if (polling) {
    const resolved = cardResolved(cardPoll.data);
    if (resolved) return <OutcomeView outcome={resolved} />;
    // A mid-poll GET failure (e.g. the row 404s/410s) is terminal — surface it instead of
    // spinning "Finishing…" until the deadline.
    if (cardPoll.error) return <OutcomeView outcome={fromError(cardPoll.error)} />;
    if (pollExhausted) {
      return (
        <section aria-label="Confirmation" className="confirmation-card">
          <p role="status">
            Still processing. This can take a moment — check the booking list, or try again.
          </p>
          <button type="button" onClick={() => void cardPoll.refetch()}>
            Check again
          </button>
        </section>
      );
    }
    return (
      <section aria-label="Confirmation" className="confirmation-card">
        <p role="status">Finishing your booking…</p>
      </section>
    );
  }

  // ---- Initial proposal: the inert card + the single execute click -------------------------
  return (
    <section aria-label="Confirmation" className="confirmation-card">
      <h4>Confirm this booking</h4>
      <dl>
        <dt>Quote</dt>
        <dd>{card.quote_id}</dd>
        <dt>Your reference</dt>
        <dd>{card.shipper_ref}</dd>
        <dt>Expires</dt>
        <dd>{new Date(card.expires_at).toLocaleString()}</dd>
      </dl>
      <button type="button" onClick={onConfirm} disabled={redeem.isPending}>
        {redeem.isPending ? "Confirming…" : "Confirm booking"}
      </button>
      <p className="hint">Nothing is booked until you click Confirm.</p>
    </section>
  );
}

function OutcomeView({ outcome }: { outcome: Outcome }) {
  const role = outcome.tone === "error" ? "alert" : "status";
  return (
    <section aria-label="Confirmation" className={`confirmation-card outcome-${outcome.tone}`}>
      <p role={role}>
        <strong>{outcome.title}</strong>
      </p>
      {outcome.bookingId && <p>Booking {outcome.bookingId}</p>}
      {outcome.detail && <p>{outcome.detail}</p>}
    </section>
  );
}

/** A settled redeem body → a display outcome. `replayed` is still a success (idempotent re-click). */
function fromRedeem(result: Exclude<RedeemResult, { status: "in_progress" }>): Outcome {
  if (result.status === "confirmed") {
    return { tone: "success", title: "Booking confirmed", bookingId: result.booking_id };
  }
  return {
    tone: "warn",
    title: "Booking created — awaiting confirmation",
    detail: result.detail,
    bookingId: result.booking_id,
  };
}

/** A polled card → a display outcome once it has settled (final_status set); null while unresolved. */
function cardResolved(card: CardState | undefined): Outcome | null {
  if (!card || card.final_status === null) return null;
  switch (card.final_status) {
    case "CONFIRMED":
      return { tone: "success", title: "Booking confirmed", bookingId: card.booking_id ?? undefined };
    case "QUOTE_UNAVAILABLE":
      return { tone: "error", title: "Quote no longer bookable", detail: "Please re-quote and try again." };
    case "EXECUTION_FAILED":
      return { tone: "error", title: "Booking could not be completed", detail: "Please retry from a new quote." };
    default: // HELD or any other created-but-not-confirmed state
      return {
        tone: "warn",
        title: "Booking created — awaiting confirmation",
        bookingId: card.booking_id ?? undefined,
      };
  }
}

/** A terminal redeem error (4xx/5xx) → a display outcome, keyed on the wire code (Condition 4). */
function fromError(err: AgentApiError): Outcome {
  switch (err.code) {
    case "CONFIRMATION_EXPIRED":
      return { tone: "error", title: "This confirmation expired", detail: "Please re-quote to book." };
    case "CONFIRMATION_NOT_FOUND":
      return { tone: "error", title: "This confirmation is no longer available" };
    case "QUOTE_UNAVAILABLE":
      return { tone: "error", title: "Quote no longer bookable", detail: "Please re-quote and try again." };
    case "BOOKING_EXECUTION_FAILED":
      return { tone: "error", title: "Booking could not be completed", detail: "Please retry from a new quote." };
    default:
      return { tone: "error", title: "Something went wrong", detail: err.message };
  }
}
