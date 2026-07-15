package com.freightpilot.rates.domain;

import java.util.UUID;

/**
 * A surcharge on a rate card (§4.1 surcharges). `amount` is cents when
 * {@code calc == FLAT} and basis points when {@code calc == PERCENT}.
 */
public record Surcharge(
        UUID id,
        UUID rateCardId,
        SurchargeType type,
        SurchargeCalc calc,
        long amount) {
}
