package com.freightpilot.rates.domain;

import java.time.LocalDate;
import java.util.UUID;

/**
 * A rate card (§4.1 rate_cards). `baseRateCents` is integer cents interpreted per
 * {@code unit}: per container (ocean), per kg (air), per mile (truck).
 */
public record RateCard(
        UUID id,
        UUID laneId,
        long baseRateCents,
        String currency,
        RateUnit unit,
        int transitDaysMin,
        int transitDaysMax,
        LocalDate validFrom,
        LocalDate validTo) {
}
