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
