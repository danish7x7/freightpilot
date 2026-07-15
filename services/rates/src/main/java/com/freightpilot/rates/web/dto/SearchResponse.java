package com.freightpilot.rates.web.dto;

import java.util.List;

/** Response for GET /api/v1/rates/search. */
public record SearchResponse(List<RateCardView> rateCards) {
}
