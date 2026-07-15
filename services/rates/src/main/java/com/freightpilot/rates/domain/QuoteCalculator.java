package com.freightpilot.rates.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Owns quote assembly in ONE place: pick the per-mode {@link RateStrategy} for the base
 * cost, then compose surcharges. Composition is mode-independent, so it lives here rather
 * than being triplicated across strategies — a single enforcement point mirrors the
 * "one class" discipline applied to the booking state machine.
 *
 * <h2>Surcharge composition (documented ordering)</h2>
 * Every surcharge is computed against the <b>base cost</b>:
 * <ul>
 *   <li>{@code FLAT} adds a fixed number of cents.</li>
 *   <li>{@code PERCENT} adds {@code base × basis_points / 10000}, rounded HALF_UP to whole cents.</li>
 * </ul>
 * Because both FLAT and PERCENT reference the base (never each other's output), <b>order is
 * immaterial by construction</b> — there is nothing to sequence and nothing to compound.
 * This matches real BAF/fuel ("percent of base", docs/domain-notes.md). Rounding is per line
 * so the stored breakdown lines sum exactly to {@code total_cents} (§4.2). All arithmetic is
 * integer/BigDecimal — never double (hard rule §7). Pure and stateless.
 */
@Component
public class QuoteCalculator {

    private final Map<Mode, RateStrategy> strategies = new EnumMap<>(Mode.class);

    public QuoteCalculator(List<RateStrategy> rateStrategies) {
        for (RateStrategy strategy : rateStrategies) {
            RateStrategy existing = strategies.put(strategy.mode(), strategy);
            if (existing != null) {
                throw new IllegalStateException("Duplicate RateStrategy for mode " + strategy.mode());
            }
        }
    }

    public QuoteResult calculate(ShipmentSpec shipment, RateCard card, Lane lane, List<Surcharge> surcharges) {
        RateStrategy strategy = strategies.get(lane.mode());
        if (strategy == null) {
            throw new IllegalStateException("No RateStrategy registered for mode " + lane.mode());
        }

        long base = strategy.baseCostCents(shipment, card, lane);

        List<BreakdownLine> breakdown = new ArrayList<>();
        breakdown.add(BreakdownLine.base(base));
        long total = base;

        for (Surcharge surcharge : surcharges) {
            BreakdownLine line = switch (surcharge.calc()) {
                case FLAT -> BreakdownLine.flat(surcharge.type(), surcharge.amount());
                case PERCENT -> BreakdownLine.percent(
                        surcharge.type(), surcharge.amount(), percentOfBase(base, surcharge.amount()));
            };
            breakdown.add(line);
            total += line.amountCents();
        }

        return new QuoteResult(base, List.copyOf(breakdown), total, card.currency(),
                card.transitDaysMin(), card.transitDaysMax());
    }

    /** base × bps / 10000, rounded HALF_UP to whole cents. */
    private static long percentOfBase(long baseCents, long basisPoints) {
        return BigDecimal.valueOf(baseCents)
                .multiply(BigDecimal.valueOf(basisPoints))
                .divide(BigDecimal.valueOf(10_000), 0, RoundingMode.HALF_UP)
                .longValueExact();
    }
}
