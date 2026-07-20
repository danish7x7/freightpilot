import { useState } from "react";
import { SearchForm, type SearchSubmission } from "./components/SearchForm";
import { QuoteList } from "./components/QuoteList";
import { QuoteBreakdown } from "./components/QuoteBreakdown";
import { BookingPanel } from "./components/BookingPanel";
import { useRateSearch, useQuote, type RateCardView } from "./api/hooks";

// Orchestrates the full manual flow: search → sortable list → quote breakdown → book → booking
// detail w/ event timeline. The rates half calls rates-service; the booking half (BookingPanel)
// calls booking-service's public API only (§2.2). ADR-0004 deferred the booking half until
// booking-service existed; it now does, so the "book" action lives here.
export function RatesPage() {
  const [submission, setSubmission] = useState<SearchSubmission | null>(null);
  const [selected, setSelected] = useState<RateCardView | null>(null);

  const search = useRateSearch(submission?.params ?? null);
  const quote = useQuote(selected?.id ?? null, submission?.shipment ?? null);

  function handleSearch(next: SearchSubmission) {
    setSubmission(next);
    setSelected(null);
  }

  return (
    <main>
      <h1>FreightPilot</h1>
      <p>Search freight rates, get a full quote, and book it.</p>

      <SearchForm onSearch={handleSearch} />

      {search.isLoading && <p>Searching rates…</p>}
      {search.isError && <p role="alert">Search failed: {search.error.message}</p>}
      {search.data && (
        <QuoteList cards={search.data} selectedId={selected?.id ?? null} onSelect={setSelected} />
      )}

      {selected && (
        <>
          {quote.isLoading && <p>Calculating quote…</p>}
          {quote.isError && <p role="alert">Quote failed: {quote.error.message}</p>}
          {quote.data && submission && (
            <>
              <QuoteBreakdown quote={quote.data} />
              {/* Keyed on the card so switching cards remounts the panel with a fresh
                  idempotency key (a new booking attempt), not a stale one. */}
              <BookingPanel key={selected.id} quote={quote.data} shipment={submission.shipment} />
            </>
          )}
        </>
      )}
    </main>
  );
}
