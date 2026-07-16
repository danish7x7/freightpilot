import type { QuoteResponse } from "../api/hooks";
import { formatMoney } from "../lib/format";

// Displays the server-computed quote. total_cents is rendered VERBATIM from the response
// (ADR-0003 guarantees breakdown lines sum to total) — the client never re-sums the
// breakdown to derive a total, which would be re-implementing rate math (§2.2).
export function QuoteBreakdown({ quote }: { quote: QuoteResponse }) {
  return (
    <section aria-label="Quote breakdown">
      <h3>
        Quote — {quote.origin_code} → {quote.dest_code} ({quote.mode})
      </h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {quote.breakdown.map((line, i) => (
            <tr key={`${line.component}-${i}`}>
              <td>{line.component}</td>
              <td>{formatMoney(line.amount_cents, quote.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td data-testid="quote-total">{formatMoney(quote.total_cents, quote.currency)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
