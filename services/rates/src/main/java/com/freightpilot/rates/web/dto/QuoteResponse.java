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
        UUID laneId,
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
        // lane_id comes from the rate card's own FK (card.laneId()), not lane.id() — so the
        // emitted (rate_card_id, lane_id) pair is sourced from one aggregate and cannot diverge.
        // The client forwards this pair verbatim into booking's POST /quotes (guardian PR-A ruling).
        return new QuoteResponse(
                card.id(), card.laneId(), lane.originCode(), lane.destCode(), lane.mode(),
                result.currency(), result.baseCostCents(), result.breakdown(), result.totalCents(),
                result.transitDaysMin(), result.transitDaysMax());
    }
}
