package com.freightpilot.rates.domain;

import java.time.LocalDate;

/**
 * Validated shipment request (§5). The shared shape consumed by rates/booking/agent.
 * `mode` and `deliverBy` are optional; for calculation the rate card is authoritative
 * for mode, so this carries what the user asked, not what the card resolves to.
 */
public record ShipmentSpec(
        String originCode,
        String destCode,
        Mode mode,
        LocalDate shipDate,
        LocalDate deliverBy,
        Cargo cargo) {
}
