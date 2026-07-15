package com.freightpilot.rates.domain;

import static com.freightpilot.rates.support.Fixtures.card;
import static com.freightpilot.rates.support.Fixtures.lane;
import static com.freightpilot.rates.support.Fixtures.shipment;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AirRateStrategyTest {

    private final AirRateStrategy strategy = new AirRateStrategy();
    private final Lane airLane = lane(Mode.AIR, null);

    @Test
    void handlesAirMode() {
        assertThat(strategy.mode()).isEqualTo(Mode.AIR);
    }

    @Test
    void usesActualWeightWhenItExceedsVolumetric() {
        // volumetric = 3 * 167 = 501 kg < 800 actual → chargeable 800; 520c/kg → 416000
        var card = card(520, RateUnit.PER_KG);
        assertThat(strategy.baseCostCents(shipment("800", "3"), card, airLane)).isEqualTo(416_000);
    }

    @Test
    void usesVolumetricWeightWhenItExceedsActual() {
        // volumetric = 3 * 167 = 501 kg > 100 actual → chargeable 501; 520c/kg → 260520
        var card = card(520, RateUnit.PER_KG);
        assertThat(strategy.baseCostCents(shipment("100", "3"), card, airLane)).isEqualTo(260_520);
    }

    @Test
    void fallsBackToActualWeightWhenNoVolume() {
        // no volume → chargeable = actual 250; 610c/kg → 152500
        var card = card(610, RateUnit.PER_KG);
        assertThat(strategy.baseCostCents(shipment("250", null), card, airLane)).isEqualTo(152_500);
    }

    @Test
    void roundsResultingCentsHalfUp() {
        // 445c/kg * 10.5 kg = 4672.5 → HALF_UP → 4673 (no intermediate weight rounding)
        var card = card(445, RateUnit.PER_KG);
        assertThat(strategy.baseCostCents(shipment("10.5", null), card, airLane)).isEqualTo(4673);
    }
}
