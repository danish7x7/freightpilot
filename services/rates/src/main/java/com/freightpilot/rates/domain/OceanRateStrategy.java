package com.freightpilot.rates.domain;

import org.springframework.stereotype.Component;

/**
 * Ocean FCL: priced per container. ShipmentSpec (§5) carries no container count, so at
 * L2 a quote is for a single FEU — {@code baseCost = base_rate_cents × 1}. Cargo weight
 * is irrelevant to ocean pricing. Multi-container is a future refinement, not a Non-Goal.
 */
@Component
public class OceanRateStrategy implements RateStrategy {

    @Override
    public Mode mode() {
        return Mode.OCEAN;
    }

    @Override
    public long baseCostCents(ShipmentSpec shipment, RateCard card, Lane lane) {
        return card.baseRateCents();
    }
}
