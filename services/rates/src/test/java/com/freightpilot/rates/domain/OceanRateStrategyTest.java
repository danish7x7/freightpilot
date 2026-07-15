package com.freightpilot.rates.domain;

import static com.freightpilot.rates.support.Fixtures.card;
import static com.freightpilot.rates.support.Fixtures.lane;
import static com.freightpilot.rates.support.Fixtures.shipment;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class OceanRateStrategyTest {

    private final OceanRateStrategy strategy = new OceanRateStrategy();

    @Test
    void handlesOceanMode() {
        assertThat(strategy.mode()).isEqualTo(Mode.OCEAN);
    }

    @Test
    void baseCostIsSingleContainerRate() {
        var card = card(268_000, RateUnit.PER_CONTAINER);
        var lane = lane(Mode.OCEAN, null);
        assertThat(strategy.baseCostCents(shipment("15000", "30"), card, lane)).isEqualTo(268_000);
    }

    @Test
    void ignoresCargoWeight() {
        var card = card(285_000, RateUnit.PER_CONTAINER);
        var lane = lane(Mode.OCEAN, null);
        long light = strategy.baseCostCents(shipment("100", null), card, lane);
        long heavy = strategy.baseCostCents(shipment("28000", "40"), card, lane);
        assertThat(light).isEqualTo(heavy).isEqualTo(285_000);
    }
}
