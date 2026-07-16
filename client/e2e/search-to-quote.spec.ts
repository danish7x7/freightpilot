import { test, expect } from "@playwright/test";
import { rateCards, quote } from "./fixtures";

// Narrowed-L4 happy path: search → sortable rate-card list → quote breakdown.
// Hermetic — the two rates endpoints are mocked with contract-typed fixtures, so the
// test drives the real React app + real openapi-fetch client without a live backend.
// The live compose-stack E2E (§9) is deferred to the deploy step — see ADR-0004.
test("search returns rate cards and a selected card yields a quote breakdown", async ({ page }) => {
  // Capture (don't assert) inside the handler so a header regression surfaces as a clear
  // assertion after navigation, not a misleading route timeout.
  let searchRequestId: string | undefined;
  await page.route("**/api/v1/rates/search*", async (route) => {
    searchRequestId = route.request().headers()["x-request-id"];
    await route.fulfill({ json: { rate_cards: rateCards } });
  });
  await page.route("**/api/v1/quotes/calculate", async (route) => {
    await route.fulfill({ json: quote });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Search rates" }).click();

  // Both rate cards render in the list.
  await expect(page.getByRole("cell", { name: "OCEAN" })).toHaveCount(rateCards.length);
  await expect(page.getByRole("row").filter({ hasText: "Shanghai → Oakland" })).toHaveCount(
    rateCards.length,
  );

  // Correlation is wired (§5) and the minted id matches RequestIdFilter's charset.
  expect(searchRequestId).toMatch(/^[A-Za-z0-9._-]{1,64}$/);

  // Quote the first card → server-computed breakdown appears.
  await page.getByRole("button", { name: "Quote" }).first().click();

  const breakdown = page.getByRole("region", { name: "Quote breakdown" });
  await expect(breakdown).toBeVisible();
  await expect(breakdown.getByText("FUEL")).toBeVisible();

  // Total is the server's total_cents, formatted — not re-summed client-side.
  await expect(page.getByTestId("quote-total")).toHaveText("$3,665.40");

  // Guardian's allowed test-only invariant: breakdown lines sum to total_cents (ADR-0003).
  const sum = quote.breakdown.reduce((acc, line) => acc + line.amount_cents, 0);
  expect(sum).toBe(quote.total_cents);
});
