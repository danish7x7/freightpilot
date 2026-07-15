package com.freightpilot.rates.domain;

import static com.freightpilot.rates.support.Fixtures.card;
import static com.freightpilot.rates.support.Fixtures.lane;
import static com.freightpilot.rates.support.Fixtures.shipment;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class TruckRateStrategyTest {

    private final TruckRateStrategy strategy = new TruckRateStrategy();

    @Test
    void handlesTruckMode() {
        assertThat(strategy.mode()).isEqualTo(Mode.TRUCK);
    }

    @Test
    void baseCostIsPerMileTimesDistance() {
        // 265c/mile * 372 mi → 98580
        var card = card(265, RateUnit.PER_MILE);
        var lane = lane(Mode.TRUCK, 372);
        assertThat(strategy.baseCostCents(shipment("5000", null), card, lane)).isEqualTo(98_580);
    }

    @Test
    void failsLoudlyWhenLaneHasNoDistance() {
        var card = card(265, RateUnit.PER_MILE);
        var lane = lane(Mode.TRUCK, null);
        assertThatThrownBy(() -> strategy.baseCostCents(shipment("5000", null), card, lane))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("distance_mi");
    }
}
