// The ONE place cents become a display string (§7 / guardian D3). Integer cents stay
// integer through the data layer; we divide by 100 only to render, and never parse a
// formatted value back into a request or into state.
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function formatTransit(minDays: number, maxDays: number): string {
  return minDays === maxDays ? `${minDays} days` : `${minDays}–${maxDays} days`;
}

/** Render a server ISO-8601 instant (e.g. a booking_events `at`) for display only. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  // A malformed instant would make Intl.format throw a RangeError and blank the timeline;
  // fall back to the raw value instead (server is trusted, but don't crash render on bad data).
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
