package com.freightpilot.rates.domain;

import org.springframework.stereotype.Component;

/**
 * Truck FTL: priced per mile — {@code baseCost = base_rate_cents × lane.distance_mi}.
 * Distance comes from the lane (TRUCK lanes always carry distance_mi); a truck lane
 * without a distance is a data error and fails loudly rather than pricing at zero.
 */
@Component
public class TruckRateStrategy implements RateStrategy {

    @Override
    public Mode mode() {
        return Mode.TRUCK;
    }

    @Override
    public long baseCostCents(ShipmentSpec shipment, RateCard card, Lane lane) {
        Integer distanceMi = lane.distanceMi();
        if (distanceMi == null) {
            throw new IllegalStateException(
                    "TRUCK lane " + lane.id() + " has no distance_mi; cannot price per-mile");
        }
        return Math.multiplyExact(card.baseRateCents(), (long) distanceMi);
    }
}
