package com.freightpilot.rates.domain;

/**
 * One line of a quote breakdown (§4.2 quotes.breakdown). `component == "BASE"` is the
 * base cost; otherwise it is a {@link SurchargeType} name. `calc`/`rateBps` are null for
 * the BASE line and for FLAT surcharges carry null rateBps. All lines sum to the quote
 * total_cents.
 */
public record BreakdownLine(
        String component,
        SurchargeCalc calc,
        Long rateBps,
        long amountCents) {

    public static BreakdownLine base(long amountCents) {
        return new BreakdownLine("BASE", null, null, amountCents);
    }

    public static BreakdownLine flat(SurchargeType type, long amountCents) {
        return new BreakdownLine(type.name(), SurchargeCalc.FLAT, null, amountCents);
    }

    public static BreakdownLine percent(SurchargeType type, long rateBps, long amountCents) {
        return new BreakdownLine(type.name(), SurchargeCalc.PERCENT, rateBps, amountCents);
    }
}
