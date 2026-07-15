package com.freightpilot.rates.domain;

import static com.freightpilot.rates.support.Fixtures.card;
import static com.freightpilot.rates.support.Fixtures.flat;
import static com.freightpilot.rates.support.Fixtures.lane;
import static com.freightpilot.rates.support.Fixtures.percent;
import static com.freightpilot.rates.support.Fixtures.shipment;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class QuoteCalculatorTest {

    private final QuoteCalculator calculator = new QuoteCalculator(
            List.of(new OceanRateStrategy(), new AirRateStrategy(), new TruckRateStrategy()));

    private final Lane oceanLane = lane(Mode.OCEAN, null);

    private QuoteResult calc(long baseRate, List<Surcharge> surcharges) {
        return calculator.calculate(shipment("15000", null), card(baseRate, RateUnit.PER_CONTAINER), oceanLane, surcharges);
    }

    @Test
    void baseOnlyWhenNoSurcharges() {
        var result = calc(268_000, List.of());
        assertThat(result.baseCostCents()).isEqualTo(268_000);
        assertThat(result.totalCents()).isEqualTo(268_000);
        assertThat(result.breakdown()).singleElement()
                .satisfies(line -> {
                    assertThat(line.component()).isEqualTo("BASE");
                    assertThat(line.amountCents()).isEqualTo(268_000);
                });
        assertThat(result.currency()).isEqualTo("USD");
    }

    @Test
    void flatSurchargeAddsFixedCents() {
        var result = calc(100_000, List.of(flat(SurchargeType.PEAK_SEASON, 45_000)));
        assertThat(result.totalCents()).isEqualTo(145_000);
    }

    @Test
    void percentSurchargeIsPercentOfBase() {
        var result = calc(100_000, List.of(percent(SurchargeType.FUEL, 1550)));
        assertThat(result.totalCents()).isEqualTo(115_500); // 100000 * 15.5%
    }

    @Test
    void percentRoundsHalfUpPerLine() {
        // 100 * 15.5% = 15.5 → HALF_UP → 16
        var result = calc(100, List.of(percent(SurchargeType.FUEL, 1550)));
        assertThat(result.breakdown().get(1).amountCents()).isEqualTo(16);
        assertThat(result.totalCents()).isEqualTo(116);
    }

    @Test
    void percentComputesOnBaseAndOrderIsImmaterial() {
        var flatThenPercent = calc(100_000,
                List.of(flat(SurchargeType.PEAK_SEASON, 45_000), percent(SurchargeType.FUEL, 1550)));
        var percentThenFlat = calc(100_000,
                List.of(percent(SurchargeType.FUEL, 1550), flat(SurchargeType.PEAK_SEASON, 45_000)));

        // percent-of-base (15500), NOT percent-of-(base+flat) (which would be 22475)
        assertThat(flatThenPercent.totalCents()).isEqualTo(160_500);
        assertThat(percentThenFlat.totalCents()).isEqualTo(160_500);
    }

    @Test
    void totalNeverBelowBaseForNonNegativeSurcharges() {
        var result = calc(268_000, List.of(
                percent(SurchargeType.FUEL, 1550),
                flat(SurchargeType.PEAK_SEASON, 45_000)));
        assertThat(result.totalCents()).isGreaterThanOrEqualTo(result.baseCostCents());
        assertThat(result.currency()).isEqualTo("USD");
    }

    @Test
    void breakdownLinesSumToTotal() {
        var result = calc(268_000, List.of(
                percent(SurchargeType.FUEL, 1550),
                flat(SurchargeType.PEAK_SEASON, 45_000),
                flat(SurchargeType.SECURITY, 12_000)));
        long sum = result.breakdown().stream().mapToLong(BreakdownLine::amountCents).sum();
        assertThat(sum).isEqualTo(result.totalCents());
        assertThat(result.totalCents()).isEqualTo(366_540); // 268000 + 41540 + 45000 + 12000
    }
}
