package com.freightpilot.rates.domain;

import java.util.List;

/**
 * The outcome of a quote calculation (domain-level, web-free). `breakdown` includes the
 * BASE line plus one line per surcharge; the lines sum exactly to {@code totalCents}.
 */
public record QuoteResult(
        long baseCostCents,
        List<BreakdownLine> breakdown,
        long totalCents,
        String currency,
        int transitDaysMin,
        int transitDaysMax) {
}
