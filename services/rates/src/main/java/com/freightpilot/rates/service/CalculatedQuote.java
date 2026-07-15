package com.freightpilot.rates.service;

import com.freightpilot.rates.domain.QuoteResult;
import com.freightpilot.rates.repository.RateCardDetail;

/** A computed quote plus the rate card/lane it was priced from (for the response). */
public record CalculatedQuote(RateCardDetail detail, QuoteResult result) {
}
