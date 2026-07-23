import { useRef, useState } from "react";
import { useTurn, type CardState, type TurnResponse } from "../api/agentHooks";
import { ConfirmationCard } from "./ConfirmationCard";

// The agent chat panel (§L5). Talks to agent-service's POST /api/v1/turns ONLY — it never imports
// bookingClient and has no path to a direct booking POST (guardian Condition 8). The one and only
// booking-causing action reachable from here is redeeming a token inside <ConfirmationCard/>, which
// requires an explicit user click. That is the load-bearing invariant, made visible: the LLM
// proposes; the human executes.

let nextId = 0;

type Entry =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "text"; text: string }
  | { id: number; kind: "form_fallback"; reason: string }
  | { id: number; kind: "tool"; tool: string; ok: boolean; status: number }
  | { id: number; kind: "proposal"; token: string; card: CardState };

function toEntry(reply: TurnResponse): Entry {
  switch (reply.kind) {
    case "text":
      return { id: nextId++, kind: "text", text: reply.text };
    case "form_fallback":
      return { id: nextId++, kind: "form_fallback", reason: reply.reason };
    case "tool":
      return { id: nextId++, kind: "tool", tool: reply.tool, ok: reply.result.ok, status: reply.result.status };
    case "proposal":
      // The secret token lives in in-memory component state only (never a URL or cache key).
      return { id: nextId++, kind: "proposal", token: reply.token, card: reply.card };
  }
}

export function ChatPanel() {
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const turn = useTurn();

  // Synchronous re-entry guard (mirrors BookingPanel): block a same-tick second submit.
  const inFlight = useRef(false);

  async function send() {
    const message = input.trim();
    if (message === "" || inFlight.current) return;
    inFlight.current = true;
    turn.reset();
    setEntries((prev) => [...prev, { id: nextId++, kind: "user", text: message }]);
    setInput("");
    try {
      const reply = await turn.mutateAsync({ conversationId, message });
      setConversationId(reply.conversation_id); // thread continuation (not persisted server-side)
      setEntries((prev) => [...prev, toEntry(reply)]);
    } catch {
      // turn.error (typed AgentApiError) is surfaced below; swallow the rejection.
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <section aria-label="Agent chat" className="chat-panel">
      <h2>Ask the agent</h2>
      <ol className="chat-log">
        {entries.map((e) => (
          <li key={e.id} className={`chat-entry chat-${e.kind}`}>
            <EntryView entry={e} />
          </li>
        ))}
      </ol>

      {turn.isError && (
        <p role="alert">The agent is unavailable right now: {turn.error.message}</p>
      )}

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void send();
        }}
      >
        <label>
          <span className="sr-only">Message the agent</span>
          <input
            name="message"
            value={input}
            onChange={(ev) => setInput(ev.target.value)}
            placeholder="e.g. Book an ocean shipment Shanghai to Oakland"
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={turn.isPending || input.trim() === ""}>
          {turn.isPending ? "Thinking…" : "Send"}
        </button>
      </form>
    </section>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "user":
      return <p><strong>You:</strong> {entry.text}</p>;
    case "text":
      return <p><strong>Agent:</strong> {entry.text}</p>;
    case "form_fallback":
      return (
        <p role="status">
          <strong>Agent:</strong> I couldn't turn that into a booking. Try the manual form above.
          {entry.reason ? ` (${entry.reason})` : ""}
        </p>
      );
    case "tool":
      return (
        <p>
          <strong>Agent:</strong> ran <code>{entry.tool}</code> —{" "}
          {entry.ok ? `done (HTTP ${entry.status})` : `the service returned HTTP ${entry.status}`}.
        </p>
      );
    case "proposal":
      return <ConfirmationCard token={entry.token} card={entry.card} />;
  }
}
