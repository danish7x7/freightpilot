import { test, expect, type Page } from "@playwright/test";
import { rateCards, quote } from "./fixtures";
import {
  persistedQuote,
  heldQuote,
  heldBooking,
  confirmedBooking,
  cancelledBooking,
  heldDetail,
  confirmedDetail,
  cancelledDetail,
  illegalTransition,
  LANE_ID,
  RATE_CARD_ID,
} from "./booking.fixtures";

// L4 booking-half E2E — hermetic: rates + booking endpoints are mocked with contract-typed
// fixtures, so the tests drive the real React app + real openapi-fetch booking client without a
// live backend. The live compose-stack E2E (§9) is deferred to the deploy step D9 (ADR-0004).

// Mock rates, navigate, search, and quote the first card so the booking panel is on screen.
async function reachBookingPanel(page: Page) {
  await page.route("**/api/v1/rates/search*", (route) =>
    route.fulfill({ json: { rate_cards: rateCards } }),
  );
  await page.route("**/api/v1/quotes/calculate", (route) => route.fulfill({ json: quote }));
  await page.goto("/");
  await page.getByRole("button", { name: "Search rates" }).click();
  await page.getByRole("button", { name: "Quote" }).first().click();
  const panel = page.getByRole("region", { name: "Book this quote" });
  await expect(panel).toBeVisible();
  return panel;
}

test("reserve → confirm → cancel, driven entirely by the server's state", async ({ page }) => {
  let persistBody: Record<string, unknown> = {};
  let bookingReqId: string | undefined;
  let idempotencyKey: string | undefined;
  const actors: Record<string, string | undefined> = {};
  let phase: "held" | "confirmed" | "cancelled" = "held";

  // Regex routes (not globs) so /bookings, /bookings/{id}/confirm|cancel, and /bookings/{id}
  // match unambiguously regardless of registration order.
  await page.route(/\/api\/v1\/quotes$/, (route) => {
    persistBody = route.request().postDataJSON();
    route.fulfill({ status: 201, json: persistedQuote });
  });
  await page.route(/\/api\/v1\/quotes\/[^/]+\/hold$/, (route) =>
    route.fulfill({ status: 200, json: heldQuote }),
  );
  await page.route(/\/api\/v1\/bookings$/, (route) => {
    const headers = route.request().headers();
    bookingReqId = headers["x-request-id"];
    idempotencyKey = headers["idempotency-key"];
    actors.create = route.request().postDataJSON()?.actor;
    route.fulfill({ status: 201, json: heldBooking });
  });
  await page.route(/\/api\/v1\/bookings\/[^/]+\/confirm$/, (route) => {
    actors.confirm = route.request().postDataJSON()?.actor;
    phase = "confirmed";
    route.fulfill({ status: 200, json: confirmedBooking });
  });
  await page.route(/\/api\/v1\/bookings\/[^/]+\/cancel$/, (route) => {
    actors.cancel = route.request().postDataJSON()?.actor;
    phase = "cancelled";
    route.fulfill({ status: 200, json: cancelledBooking });
  });
  // Stateful detail: the timeline always comes from the server's refetch, never an optimistic guess.
  await page.route(/\/api\/v1\/bookings\/[^/]+$/, (route) =>
    route.fulfill({
      json: phase === "cancelled" ? cancelledDetail : phase === "confirmed" ? confirmedDetail : heldDetail,
    }),
  );

  const panel = await reachBookingPanel(page);
  await panel.getByLabel("Your reference").fill("PO-4471");
  await panel.getByRole("button", { name: "Reserve booking" }).click();

  // HELD, with the timeline from the server.
  await expect(page.getByTestId("booking-status")).toHaveText("HELD");
  const timeline = page.getByRole("region", { name: "Booking timeline" });
  await expect(timeline.getByText("QUOTED → HELD")).toBeVisible();

  // The client couriered the WHOLE priced quote verbatim — the id pair AND the money — into
  // booking's POST /quotes; it invents nothing and re-sums nothing (§2.2, integer cents).
  expect(persistBody.lane_id).toBe(LANE_ID);
  expect(persistBody.rate_card_id).toBe(RATE_CARD_ID);
  expect(persistBody.total_cents).toBe(quote.total_cents);
  expect(persistBody.currency).toBe(quote.currency);
  // Correlation + idempotency wired (§5 / ADR-0005).
  expect(bookingReqId).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
  expect(idempotencyKey).toMatch(/^[A-Za-z0-9._-]{1,64}$/);

  // Confirm (real user click) → CONFIRMED.
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("CONFIRMED");
  await expect(timeline.getByText("HELD → CONFIRMED")).toBeVisible();

  // Cancel → CANCELLED.
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("CANCELLED");
  await expect(timeline.getByText("CONFIRMED → CANCELLED")).toBeVisible();

  // The UI can only ever act as the user in Phase 1 (guardian conditions 4 & 7).
  expect(actors).toEqual({ create: "user", confirm: "user", cancel: "user" });
  // "Ready for the agent" affordance: the legend names all three actors up front.
  await expect(timeline.getByText(/the AI agent joins in Phase 2/)).toBeVisible();
});

test("a failed reserve reuses ONE Idempotency-Key across the retry (no double-book)", async ({
  page,
}) => {
  const keys: string[] = [];
  let bookingAttempts = 0;

  await page.route(/\/api\/v1\/quotes$/, (route) => route.fulfill({ status: 201, json: persistedQuote }));
  await page.route(/\/api\/v1\/quotes\/[^/]+\/hold$/, (route) =>
    route.fulfill({ status: 200, json: heldQuote }),
  );
  await page.route(/\/api\/v1\/bookings$/, (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    bookingAttempts += 1;
    // Fail the first create-booking, succeed on the retry.
    if (bookingAttempts === 1) {
      route.fulfill({ status: 500, json: { code: "INTERNAL_ERROR", message: "boom", details: [] } });
    } else {
      route.fulfill({ status: 201, json: heldBooking });
    }
  });
  await page.route(/\/api\/v1\/bookings\/[^/]+$/, (route) => route.fulfill({ json: heldDetail }));

  const panel = await reachBookingPanel(page);
  await panel.getByLabel("Your reference").fill("PO-4471");

  // First attempt fails at create-booking; the server's error is surfaced, panel stays.
  await panel.getByRole("button", { name: "Reserve booking" }).click();
  await expect(panel.getByRole("alert")).toContainText("boom");

  // Retry succeeds.
  await panel.getByRole("button", { name: "Reserve booking" }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("HELD");

  // The SAME idempotency key was sent both times — first-write-wins can't double-book (ADR-0005).
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(keys[0]).not.toBe("");
});

test("a raced confirm surfaces the server's 409 veto verbatim; status is unchanged", async ({
  page,
}) => {
  await page.route(/\/api\/v1\/quotes$/, (route) => route.fulfill({ status: 201, json: persistedQuote }));
  await page.route(/\/api\/v1\/quotes\/[^/]+\/hold$/, (route) =>
    route.fulfill({ status: 200, json: heldQuote }),
  );
  await page.route(/\/api\/v1\/bookings$/, (route) => route.fulfill({ status: 201, json: heldBooking }));
  // booking-service vetoes the transition — the client must NOT enforce §2.4 itself; it surfaces
  // whatever the server returns (guardian condition 3).
  await page.route(/\/api\/v1\/bookings\/[^/]+\/confirm$/, (route) =>
    route.fulfill({ status: 409, json: illegalTransition }),
  );
  await page.route(/\/api\/v1\/bookings\/[^/]+$/, (route) => route.fulfill({ json: heldDetail }));

  const panel = await reachBookingPanel(page);
  await panel.getByLabel("Your reference").fill("PO-4471");
  await panel.getByRole("button", { name: "Reserve booking" }).click();
  await expect(page.getByTestId("booking-status")).toHaveText("HELD");

  await page.getByRole("button", { name: "Confirm booking" }).click();
  // The server's envelope message is shown verbatim; the booking stays HELD (no optimistic flip).
  await expect(page.getByRole("alert")).toContainText(illegalTransition.message);
  await expect(page.getByTestId("booking-status")).toHaveText("HELD");
});
