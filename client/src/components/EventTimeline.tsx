import type { Actor, BookingEvent } from "../api/bookingHooks";
import { formatDateTime } from "../lib/format";

// The append-only booking_events log (§2.4), rendered oldest → newest. Each transition is
// attributed to an actor ∈ {user, agent, system}. The contract's Actor enum has all three;
// we render all three distinctly SO THE AGENT SLOT IS VISIBLY READY, not missing (see the
// legend below). In Phase 1 every event is actor='user'; agent/system fill in from Phase 2 —
// this component needs ZERO change when they do (no agent-anticipating plumbing, just labels).
const ACTORS: Record<Actor, { label: string; blurb: string }> = {
  user: { label: "User", blurb: "you, acting in the UI" },
  agent: { label: "Agent", blurb: "the AI agent (arrives Phase 2)" },
  system: { label: "System", blurb: "an automated transition (e.g. expiry)" },
};

export function EventTimeline({ events }: { events: BookingEvent[] }) {
  return (
    <section aria-label="Booking timeline">
      <h3>Timeline</h3>
      <ol>
        {events.map((event, i) => {
          // Defensive: if booking-service ever sends an actor outside the enum (contract drift),
          // fall back to the raw value rather than throwing and blanking the whole timeline.
          const meta = ACTORS[event.actor] ?? { label: event.actor, blurb: "unknown actor" };
          return (
            <li key={`${event.to_status}-${event.at}-${i}`}>
              <span title={meta.blurb}>[{meta.label}]</span>{" "}
              <strong>{event.from_status ?? "—"}</strong> → <strong>{event.to_status}</strong>
              <time dateTime={event.at}> · {formatDateTime(event.at)}</time>
            </li>
          );
        })}
      </ol>

      {/* "Ready for the agent" affordance: a static legend naming all three actors, so an
          agent-attributed booking reads as an intended future state rather than a gap. */}
      <p role="note">
        Every action is attributed to an actor —{" "}
        {(Object.keys(ACTORS) as Actor[]).map((a, i) => (
          <span key={a}>
            {i > 0 && ", "}
            <strong>{ACTORS[a].label}</strong> ({ACTORS[a].blurb})
          </span>
        ))}
        . Today that is always <strong>User</strong>; the AI agent joins in Phase 2.
      </p>
    </section>
  );
}
