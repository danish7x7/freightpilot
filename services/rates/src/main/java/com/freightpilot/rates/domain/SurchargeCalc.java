package com.freightpilot.rates.domain;

/**
 * How a surcharge amount is interpreted. Mirrors the Postgres enum `surcharge_calc`
 * (§4.1). FLAT: `amount` is cents. PERCENT: `amount` is basis points applied to the
 * base cost (e.g. 1550 = 15.50%).
 */
public enum SurchargeCalc {
    FLAT,
    PERCENT
}
