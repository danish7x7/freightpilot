import { describe, expect, test } from "vitest";
import { createRatesClient } from "../../src/api/rates.js";
import { calculateQuoteTool, searchRatesTool } from "../../src/tools/rates.js";
import type { ToolClients } from "../../src/tools/types.js";
import { useMockHttp } from "../llm/mockHttp.js";

const RATES_ORIGIN = "http://rates-service:8080";
const http = useMockHttp();

// Only the rates client is exercised here; booking is unused, so a throwaway origin is fine.
function clients(): ToolClients {
  return {
    rates: createRatesClient(RATES_ORIGIN),
    booking: null as never,
  };
}

describe("search_rates (courier over GET /api/v1/rates/search)", () => {
  test("forwards a 200 response verbatim", async () => {
    const body = { rate_cards: [{ id: "rc-1", origin_code: "CNSHA" }] };
    http.agent
      .get(RATES_ORIGIN)
      .intercept({
        path: "/api/v1/rates/search",
        method: "GET",
        query: { origin: "CNSHA", dest: "USOAK", mode: "OCEAN", ship_date: "2026-08-01" },
      })
      .reply(200, body);

    const exec = await searchRatesTool.execute(
      { origin: "CNSHA", dest: "USOAK", mode: "OCEAN", ship_date: "2026-08-01" },
      clients(),
    );

    expect(exec).toEqual({ kind: "service_result", result: { ok: true, status: 200, data: body } });
  });

  test("forwards a 400 error envelope verbatim (does not re-decide)", async () => {
    const envelope = { code: "VALIDATION_ERROR", message: "bad ship_date", details: ["ship_date"] };
    http.agent
      .get(RATES_ORIGIN)
      .intercept({ path: "/api/v1/rates/search", method: "GET", query: { origin: "CNSHA", dest: "USOAK", mode: "AIR", ship_date: "2026-08-01" } })
      .reply(400, envelope);

    const exec = await searchRatesTool.execute(
      { origin: "CNSHA", dest: "USOAK", mode: "AIR", ship_date: "2026-08-01" },
      clients(),
    );

    expect(exec).toEqual({ kind: "service_result", result: { ok: false, status: 400, error: envelope } });
  });
});

describe("calculate_quote (courier over POST /api/v1/quotes/calculate)", () => {
  test("forwards a 200 quote verbatim", async () => {
    const body = { rate_card_id: "rc-1", lane_id: "ln-1", total_cents: 123456, breakdown: [] };
    http.agent
      .get(RATES_ORIGIN)
      .intercept({ path: "/api/v1/quotes/calculate", method: "POST" })
      .reply(200, body);

    const exec = await calculateQuoteTool.execute(
      {
        rate_card_id: "11111111-1111-1111-1111-111111111111",
        shipment: {
          origin_code: "CNSHA",
          dest_code: "USOAK",
          ship_date: "2026-08-01",
          cargo: { weight_kg: 5000, description: "electronics" },
        },
      },
      clients(),
    );

    expect(exec).toEqual({ kind: "service_result", result: { ok: true, status: 200, data: body } });
  });
});
