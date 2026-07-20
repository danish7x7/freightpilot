// E2E fixtures typed against the GENERATED contract types (not hand-rolled JSON), so a
// breaking change to rates.openapi.yaml fails `tsc` here — the mocked E2E can't silently
// drift from rates-service reality (guardian condition C). The breakdown sums to
// total_cents by construction (ADR-0003), asserted in the spec.
import type { components } from "../src/api/rates.gen";

type RateCardView = components["schemas"]["RateCardView"];
type QuoteResponse = components["schemas"]["QuoteResponse"];

export const rateCards: RateCardView[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    origin_code: "CNSHA",
    origin_name: "Shanghai",
    dest_code: "USOAK",
    dest_name: "Oakland",
    mode: "OCEAN",
    distance_mi: null,
    base_rate_cents: 268000,
    currency: "USD",
    unit: "PER_CONTAINER",
    transit_days_min: 30,
    transit_days_max: 35,
    valid_from: "2026-07-01",
    valid_to: "2026-09-30",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    origin_code: "CNSHA",
    origin_name: "Shanghai",
    dest_code: "USOAK",
    dest_name: "Oakland",
    mode: "OCEAN",
    distance_mi: null,
    base_rate_cents: 290000,
    currency: "USD",
    unit: "PER_CONTAINER",
    transit_days_min: 28,
    transit_days_max: 32,
    valid_from: "2026-07-01",
    valid_to: "2026-09-30",
  },
];

export const quote: QuoteResponse = {
  rate_card_id: "11111111-1111-1111-1111-111111111111",
  // lane_id is emitted by rates alongside rate_card_id (same rate-card aggregate) and forwarded
  // verbatim into booking's POST /quotes — see the booking-flow E2E. Fixed here so drift breaks tsc.
  lane_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  origin_code: "CNSHA",
  dest_code: "USOAK",
  mode: "OCEAN",
  currency: "USD",
  base_cost_cents: 268000,
  breakdown: [
    { component: "BASE", amount_cents: 268000 },
    { component: "FUEL", calc: "PERCENT", rate_bps: 1550, amount_cents: 41540 },
    { component: "PEAK_SEASON", calc: "FLAT", amount_cents: 45000 },
    { component: "SECURITY", calc: "FLAT", amount_cents: 12000 },
  ],
  total_cents: 366540,
  transit_days_min: 30,
  transit_days_max: 35,
};
