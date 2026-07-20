// Booking E2E fixtures typed against the GENERATED booking contract (not hand-rolled JSON), so
// a breaking change to booking.openapi.yaml fails `tsc` here — the mocked booking E2E can't
// silently drift from booking-service reality (guardian condition 8, mirroring the rates half).
import type { components } from "../src/api/booking.gen";

type Quote = components["schemas"]["Quote"];
type Booking = components["schemas"]["Booking"];
type BookingDetail = components["schemas"]["BookingDetail"];

export const QUOTE_ID = "99999999-9999-9999-9999-000000000001";
export const BOOKING_ID = "88888888-8888-8888-8888-000000000001";
export const LANE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const RATE_CARD_ID = "11111111-1111-1111-1111-111111111111";

// The quote booking-service persists from the couriered rates quote (POST /quotes → ACTIVE).
export const persistedQuote: Quote = {
  id: QUOTE_ID,
  lane_id: LANE_ID,
  rate_card_id: RATE_CARD_ID,
  shipment: {
    origin_code: "CNSHA",
    dest_code: "USOAK",
    mode: "OCEAN",
    ship_date: "2026-08-01",
    cargo: { weight_kg: 12000, description: "General cargo" },
  },
  breakdown: [
    { component: "BASE", amount_cents: 268000 },
    { component: "FUEL", calc: "PERCENT", rate_bps: 1550, amount_cents: 41540 },
  ],
  total_cents: 366540,
  currency: "USD",
  status: "ACTIVE",
  expires_at: "2026-08-02T00:00:00.000Z",
  created_at: "2026-07-19T12:00:00.000Z",
};

export const heldQuote: Quote = { ...persistedQuote, status: "HELD" };

export const heldBooking: Booking = {
  id: BOOKING_ID,
  quote_id: QUOTE_ID,
  shipper_ref: "PO-4471",
  status: "HELD",
  created_at: "2026-07-19T12:00:01.000Z",
  confirmed_at: null,
};

export const confirmedBooking: Booking = {
  ...heldBooking,
  status: "CONFIRMED",
  confirmed_at: "2026-07-19T12:00:02.000Z",
};

export const cancelledBooking: Booking = { ...confirmedBooking, status: "CANCELLED" };

// Every event is actor='user' in Phase 1 — the timeline still renders the full actor legend.
export const heldDetail: BookingDetail = {
  booking: heldBooking,
  events: [
    { from_status: null, to_status: "QUOTED", actor: "user", at: "2026-07-19T12:00:01.000Z" },
    { from_status: "QUOTED", to_status: "HELD", actor: "user", at: "2026-07-19T12:00:01.500Z" },
  ],
};

export const confirmedDetail: BookingDetail = {
  booking: confirmedBooking,
  events: [
    ...heldDetail.events,
    { from_status: "HELD", to_status: "CONFIRMED", actor: "user", at: "2026-07-19T12:00:02.000Z" },
  ],
};

export const cancelledDetail: BookingDetail = {
  booking: cancelledBooking,
  events: [
    ...confirmedDetail.events,
    { from_status: "CONFIRMED", to_status: "CANCELLED", actor: "user", at: "2026-07-19T12:00:03.000Z" },
  ],
};

// The uniform error envelope booking-service returns on an illegal transition (§2.4 / §5).
export const illegalTransition = {
  code: "ILLEGAL_TRANSITION",
  message: "Illegal booking transition: CONFIRMED → CONFIRMED",
  details: [],
};
