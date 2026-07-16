import { useState } from "react";
import type { RateCardView } from "../api/hooks";
import { formatMoney, formatTransit } from "../lib/format";

type SortKey = "base_rate_cents" | "transit_days_min";

// Sort is a raw column sort on server-provided scalars only. It deliberately does NOT
// rank by true total (base + surcharges) — that includes surcharge math (ADR-0003) which
// lives server-side in /quotes/calculate, not in the client (§2.2 no business logic).
export function QuoteList({
  cards,
  selectedId,
  onSelect,
}: {
  cards: RateCardView[];
  selectedId: string | null;
  onSelect: (card: RateCardView) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("base_rate_cents");
  const sorted = [...cards].sort((a, b) => a[sortKey] - b[sortKey]);

  if (cards.length === 0) {
    return <p>No rate cards match this lane and ship date.</p>;
  }

  return (
    <div>
      <label>
        Sort by{" "}
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
          <option value="base_rate_cents">Base rate</option>
          <option value="transit_days_min">Transit time</option>
        </select>
      </label>
      <table>
        <thead>
          <tr>
            <th scope="col">Lane</th>
            <th scope="col">Mode</th>
            <th scope="col">Base rate</th>
            <th scope="col">Transit</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((card) => (
            <tr key={card.id} aria-selected={card.id === selectedId}>
              <td>
                {card.origin_name} → {card.dest_name}
              </td>
              <td>{card.mode}</td>
              {/* Base rate only — final total incl. surcharges comes from a quote. */}
              <td>{formatMoney(card.base_rate_cents, card.currency)}</td>
              <td>{formatTransit(card.transit_days_min, card.transit_days_max)}</td>
              <td>
                <button type="button" onClick={() => onSelect(card)}>
                  Quote
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
