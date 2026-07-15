package com.freightpilot.rates.web.dto;

import com.freightpilot.rates.domain.BreakdownLine;
import com.freightpilot.rates.domain.Mode;
import com.freightpilot.rates.service.CalculatedQuote;
import java.util.List;
import java.util.UUID;

/**
 * Response for POST /api/v1/quotes/calculate. This is a cross-service contract — booking
 * snapshots {@code breakdown}/{@code totalCents} into quotes.breakdown JSONB (§4.2). The
 * breakdown lines sum exactly to {@code totalCents}.
 */
public record QuoteResponse(
        UUID rateCardId,
        String originCode,
        String destCode,
        Mode mode,
        String currency,
        long baseCostCents,
        List<BreakdownLine> breakdown,
        long totalCents,
        int transitDaysMin,
        int transitDaysMax) {

    public static QuoteResponse from(CalculatedQuote quote) {
        var card = quote.detail().card();
        var lane = quote.detail().lane();
        var result = quote.result();
        return new QuoteResponse(
                card.id(), lane.originCode(), lane.destCode(), lane.mode(), result.currency(),
                result.baseCostCents(), result.breakdown(), result.totalCents(),
                result.transitDaysMin(), result.transitDaysMax());
    }
}
