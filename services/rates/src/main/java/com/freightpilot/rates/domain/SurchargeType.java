package com.freightpilot.rates.domain;

/** Surcharge category. Mirrors the Postgres enum `surcharge_type` (§4.1). */
public enum SurchargeType {
    FUEL,
    PEAK_SEASON,
    SECURITY,
    HANDLING
}
