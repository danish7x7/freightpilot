import { test, expect, type Page } from "@playwright/test";

// D14 agent E2E — hermetic: agent-service's turn + gate endpoints are mocked with contract-typed
// fixtures, so the test drives the REAL React chat panel + real openapi-fetch agent client without a
// live backend or LLM. It makes the load-bearing invariant visible in CI: the agent PROPOSES (an
// inert card + token) and only ONE explicit user click redeems the token and books. The live-stack
// E2E (real LLM + real booking) stays deferred (ADR-0004).

const CONF_ID = "11111111-1111-1111-1111-111111111111";
const QUOTE_ID = "22222222-2222-2222-2222-222222222222";
const BOOKING_ID = "33333333-3333-3333-3333-333333333333";
const TOKEN = "A".repeat(43);

const card = {
  confirmation_id: CONF_ID,
  quote_id: QUOTE_ID,
  shipper_ref: "PO-1",
  status: "pending",
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  booking_id: null,
  final_status: null,
};
const proposalReply = { kind: "proposal", conversation_id: "conv-1", token: TOKEN, card };
const confirmed = {
  status: "confirmed",
  confirmation_id: CONF_ID,
  booking_id: BOOKING_ID,
  final_status: "CONFIRMED",
  replayed: false,
};

// Fail loudly if the agent flow ever issues a DIRECT booking POST — it must go through the gate.
async function forbidDirectBooking(page: Page) {
  await page.route(/\/api\/v1\/bookings/, (route) => {
    throw new Error(`agent flow issued a forbidden direct booking call: ${route.request().url()}`);
  });
}

async function sendMessage(page: Page) {
  const chat = page.getByRole("region", { name: "Agent chat" });
  await chat.getByPlaceholder(/Book an ocean shipment/).fill("Book ocean Shanghai to Oakland as PO-1");
  await chat.getByRole("button", { name: "Send" }).click();
  return chat;
}

test("chat → proposal card → single Confirm click → confirmed; exactly one redeem, no direct book", async ({
  page,
}) => {
  let turnCount = 0;
  let redeemCount = 0;
  const redeemUrls: string[] = [];

  await forbidDirectBooking(page);
  await page.route(/\/api\/v1\/turns$/, (route) => {
    turnCount += 1;
    route.fulfill({ status: 200, json: proposalReply });
  });
  await page.route(/\/api\/v1\/confirmations\/[^/]+$/, (route) => {
    redeemCount += 1;
    redeemUrls.push(route.request().url());
    expect(route.request().method()).toBe("POST");
    route.fulfill({ status: 200, json: confirmed });
  });

  await page.goto("/");
  const chat = await sendMessage(page);

  // The agent proposed: the inert card is on screen and nothing has booked yet.
  const cardRegion = chat.getByRole("region", { name: "Confirmation" });
  await expect(cardRegion.getByRole("heading", { name: "Confirm this booking" })).toBeVisible();
  expect(redeemCount).toBe(0);
  expect(turnCount).toBe(1);

  // ONE explicit click executes.
  await cardRegion.getByRole("button", { name: "Confirm booking" }).click();
  await expect(cardRegion.getByText("Booking confirmed")).toBeVisible();
  await expect(cardRegion.getByText(BOOKING_ID)).toBeVisible();

  // Exactly one redeem for one click; the token rode the gate path, not a booking path.
  expect(redeemCount).toBe(1);
  expect(redeemUrls[0]).toContain(`/api/v1/confirmations/${TOKEN}`);

  // Token containment: it never entered a navigable URL or browser history (the app stayed at "/").
  expect(page.url()).not.toContain(TOKEN);
  expect(new URL(page.url()).pathname).toBe("/");
});

test("the Confirm button disables while the redeem is in flight (one click = one redeem)", async ({
  page,
}) => {
  let redeemCount = 0;
  await forbidDirectBooking(page);
  await page.route(/\/api\/v1\/turns$/, (route) => route.fulfill({ status: 200, json: proposalReply }));
  await page.route(/\/api\/v1\/confirmations\/[^/]+$/, async (route) => {
    redeemCount += 1;
    await new Promise((r) => setTimeout(r, 600)); // hold the response so we can observe the pending UI
    route.fulfill({ status: 200, json: confirmed });
  });

  await page.goto("/");
  const chat = await sendMessage(page);
  const cardRegion = chat.getByRole("region", { name: "Confirmation" });
  const confirmBtn = cardRegion.getByRole("button", { name: /Confirm/ });

  await confirmBtn.click();
  // While pending the button is disabled and relabelled — a second click cannot land.
  await expect(cardRegion.getByRole("button", { name: "Confirming…" })).toBeDisabled();

  await expect(cardRegion.getByText("Booking confirmed")).toBeVisible();
  expect(redeemCount).toBe(1);
});

test("held_unconfirmed (200) renders as created-awaiting-confirmation, not a failure", async ({
  page,
}) => {
  await forbidDirectBooking(page);
  await page.route(/\/api\/v1\/turns$/, (route) => route.fulfill({ status: 200, json: proposalReply }));
  await page.route(/\/api\/v1\/confirmations\/[^/]+$/, (route) =>
    route.fulfill({
      status: 200,
      json: {
        status: "held_unconfirmed",
        confirmation_id: CONF_ID,
        booking_id: BOOKING_ID,
        final_status: "HELD",
        detail: "confirm ack was lost",
      },
    }),
  );

  await page.goto("/");
  const chat = await sendMessage(page);
  const cardRegion = chat.getByRole("region", { name: "Confirmation" });
  await cardRegion.getByRole("button", { name: "Confirm booking" }).click();

  await expect(cardRegion.getByText("Booking created — awaiting confirmation")).toBeVisible();
  await expect(cardRegion.getByText(BOOKING_ID)).toBeVisible();
});

test("a 202 in_progress redeem polls the card to a confirmed resolution", async ({ page }) => {
  await forbidDirectBooking(page);
  await page.route(/\/api\/v1\/turns$/, (route) => route.fulfill({ status: 200, json: proposalReply }));
  // Same path for POST (redeem) and GET (poll) — distinguish by method: redeem races to 202, the
  // card poll then resolves to CONFIRMED.
  await page.route(/\/api\/v1\/confirmations\/[^/]+$/, (route) => {
    if (route.request().method() === "POST") {
      route.fulfill({ status: 202, json: { status: "in_progress", confirmation_id: CONF_ID } });
    } else {
      route.fulfill({
        status: 200,
        json: { ...card, status: "consumed", booking_id: BOOKING_ID, final_status: "CONFIRMED" },
      });
    }
  });

  await page.goto("/");
  const chat = await sendMessage(page);
  const cardRegion = chat.getByRole("region", { name: "Confirmation" });
  await cardRegion.getByRole("button", { name: "Confirm booking" }).click();

  // Poll resolves (interval ~1.5s) → the terminal confirmed state, no manual refresh.
  await expect(cardRegion.getByText("Booking confirmed")).toBeVisible();
  await expect(cardRegion.getByText(BOOKING_ID)).toBeVisible();
});

test("a never-resolving 202 stops at the deadline with a terminal state, never an infinite spinner", async ({
  page,
}) => {
  // Fake the clock so we can cross the 20s poll deadline instantly (Condition 5).
  await page.clock.install();
  await forbidDirectBooking(page);
  await page.route(/\/api\/v1\/turns$/, (route) => route.fulfill({ status: 200, json: proposalReply }));
  await page.route(/\/api\/v1\/confirmations\/[^/]+$/, (route) => {
    if (route.request().method() === "POST") {
      route.fulfill({ status: 202, json: { status: "in_progress", confirmation_id: CONF_ID } });
    } else {
      // The winner never records an outcome — the card stays unresolved (crashed-winner case).
      route.fulfill({ status: 200, json: { ...card, status: "consumed" } });
    }
  });

  await page.goto("/");
  const chat = await sendMessage(page);
  const cardRegion = chat.getByRole("region", { name: "Confirmation" });
  await cardRegion.getByRole("button", { name: "Confirm booking" }).click();

  // Polling starts…
  await expect(cardRegion.getByText("Finishing your booking…")).toBeVisible();
  // …then the deadline passes and it lands on a bounded terminal state with a manual retry.
  await page.clock.fastForward(21_000);
  await expect(cardRegion.getByText(/Still processing/)).toBeVisible();
  await expect(cardRegion.getByRole("button", { name: "Check again" })).toBeVisible();
});

test("a redeem error surfaces the wire code, not a raw failure (expired → re-quote)", async ({
  page,
}) => {
  await forbidDirectBooking(page);
  await page.route(/\/api\/v1\/turns$/, (route) => route.fulfill({ status: 200, json: proposalReply }));
  await page.route(/\/api\/v1\/confirmations\/[^/]+$/, (route) =>
    route.fulfill({
      status: 410,
      json: { code: "CONFIRMATION_EXPIRED", message: "This confirmation has expired", details: [] },
    }),
  );

  await page.goto("/");
  const chat = await sendMessage(page);
  const cardRegion = chat.getByRole("region", { name: "Confirmation" });
  await cardRegion.getByRole("button", { name: "Confirm booking" }).click();

  await expect(cardRegion.getByText("This confirmation expired")).toBeVisible();
  await expect(cardRegion.getByText(/re-quote/i)).toBeVisible();
});
