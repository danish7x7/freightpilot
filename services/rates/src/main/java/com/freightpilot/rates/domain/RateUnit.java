package com.freightpilot.rates.domain;

/** Billing unit for a rate card. Mirrors the Postgres enum `rate_unit` (§4.1). */
public enum RateUnit {
    PER_CONTAINER,
    PER_KG,
    PER_PALLET,
    PER_MILE
}
