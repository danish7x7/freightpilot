package com.freightpilot.rates.domain;

import java.util.UUID;

/** A shipping lane (§4.1 lanes). `distanceMi` is set for TRUCK lanes only. */
public record Lane(
        UUID id,
        String originCode,
        String originName,
        String destCode,
        String destName,
        Mode mode,
        Integer distanceMi) {
}
