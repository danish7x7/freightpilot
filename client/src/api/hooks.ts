// Data hooks over the rates contract. Types come straight from the generated client
// (§5 "do not fork") and every request goes through openapi-fetch (no hand-built URLs).
import { useQuery } from "@tanstack/react-query";
import { ratesClient, RatesApiError } from "./rates";
import type { components } from "./rates.gen";

export type RateCardView = components["schemas"]["RateCardView"];
export type QuoteResponse = components["schemas"]["QuoteResponse"];
export type ShipmentSpec = components["schemas"]["ShipmentSpec"];
export type Mode = components["schemas"]["Mode"];

export interface SearchParams {
  origin: string;
  dest: string;
  mode: Mode;
  ship_date: string;
}

/** GET /api/v1/rates/search — rate cards valid on the ship date for the lane. */
export function useRateSearch(params: SearchParams | null) {
  return useQuery({
    queryKey: ["rates", params],
    enabled: params !== null,
    queryFn: async () => {
      const { data, error } = await ratesClient.GET("/api/v1/rates/search", {
        params: { query: params! },
      });
      if (error || !data) throw new RatesApiError(error);
      return data.rate_cards;
    },
  });
}

/**
 * POST /api/v1/quotes/calculate — full quote with surcharge breakdown for a selected
 * card. Pure server-side calculation (no persistence); the client never does rate math.
 */
export function useQuote(rateCardId: string | null, shipment: ShipmentSpec | null) {
  return useQuery({
    queryKey: ["quote", rateCardId, shipment],
    enabled: rateCardId !== null && shipment !== null,
    queryFn: async () => {
      const { data, error } = await ratesClient.POST("/api/v1/quotes/calculate", {
        body: { rate_card_id: rateCardId!, shipment: shipment! },
      });
      if (error || !data) throw new RatesApiError(error);
      return data;
    },
  });
}
