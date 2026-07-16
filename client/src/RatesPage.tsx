import { useState } from "react";
import { SearchForm, type SearchSubmission } from "./components/SearchForm";
import { QuoteList } from "./components/QuoteList";
import { QuoteBreakdown } from "./components/QuoteBreakdown";
import { useRateSearch, useQuote, type RateCardView } from "./api/hooks";

// Orchestrates the rates-only manual flow: search → sortable list → quote breakdown.
// Booking (book action, detail, event timeline) is deferred until booking-service exists
// — see ADR-0004. There is intentionally no "book" button here.
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
      <p>Search freight rates and get a full quote. (Booking arrives in a later layer.)</p>

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
          {quote.data && <QuoteBreakdown quote={quote.data} />}
        </>
      )}
    </main>
  );
}
