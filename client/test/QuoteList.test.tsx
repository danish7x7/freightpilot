import { render, fireEvent } from "@testing-library/react";
import { expect, test } from "vitest";
import { QuoteList } from "../src/components/QuoteList";
import type { RateCardView } from "../src/api/hooks";

const base = {
  origin_code: "CNSHA",
  origin_name: "Shanghai",
  dest_code: "USOAK",
  dest_name: "Oakland",
  mode: "OCEAN",
  currency: "USD",
  unit: "PER_CONTAINER",
  valid_from: "2026-07-01",
  valid_to: "2026-09-30",
} satisfies Partial<RateCardView>;

// Cheaper base rate but slower; pricier but faster — so the two sort keys disagree.
const cards: RateCardView[] = [
  { ...base, id: "a", base_rate_cents: 268000, transit_days_min: 30, transit_days_max: 35 },
  { ...base, id: "b", base_rate_cents: 290000, transit_days_min: 28, transit_days_max: 32 },
];

function firstRowText(container: HTMLElement): string {
  return container.querySelector("tbody tr")?.textContent ?? "";
}

test("sorts by server scalars only — base rate by default, transit on toggle", () => {
  const { container, getByRole } = render(
    <QuoteList cards={cards} selectedId={null} onSelect={() => {}} />,
  );

  // Default: base_rate_cents ascending → the $2,680.00 card leads.
  expect(firstRowText(container)).toContain("$2,680.00");

  // Toggle to transit → the faster (28–32 day) card leads, which is the pricier one —
  // proving the sort is a raw column sort, not a total-price ranking.
  fireEvent.change(getByRole("combobox"), { target: { value: "transit_days_min" } });
  expect(firstRowText(container)).toContain("$2,900.00");
});
