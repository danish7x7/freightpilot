package com.freightpilot.rates.web.dto;

import com.freightpilot.rates.domain.Mode;
import com.freightpilot.rates.domain.RateUnit;
import com.freightpilot.rates.repository.RateCardDetail;
import java.time.LocalDate;
import java.util.UUID;

/** A rate card flattened with its lane, for /rates/search responses. */
public record RateCardView(
        UUID id,
        String originCode,
        String originName,
        String destCode,
        String destName,
        Mode mode,
        Integer distanceMi,
        long baseRateCents,
        String currency,
        RateUnit unit,
        int transitDaysMin,
        int transitDaysMax,
        LocalDate validFrom,
        LocalDate validTo) {

    public static RateCardView from(RateCardDetail detail) {
        var card = detail.card();
        var lane = detail.lane();
        return new RateCardView(
                card.id(), lane.originCode(), lane.originName(), lane.destCode(), lane.destName(),
                lane.mode(), lane.distanceMi(), card.baseRateCents(), card.currency(), card.unit(),
                card.transitDaysMin(), card.transitDaysMax(), card.validFrom(), card.validTo());
    }
}
