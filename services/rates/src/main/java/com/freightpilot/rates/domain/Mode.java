package com.freightpilot.rates.domain;

/** Transport mode. Mirrors the Postgres enum `mode` (§4.1). */
public enum Mode {
    OCEAN,
    AIR,
    TRUCK
}
