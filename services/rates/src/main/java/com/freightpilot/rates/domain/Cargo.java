package com.freightpilot.rates.domain;

import java.math.BigDecimal;

/**
 * Cargo details from a ShipmentSpec (§5). Weights/volumes are BigDecimal — money and
 * measures never use double (hard rule §7). `volumeCbm` is optional (air volumetric
 * weight needs it; if absent, chargeable weight falls back to actual weight).
 */
public record Cargo(
        Integer pallets,
        BigDecimal weightKg,
        BigDecimal volumeCbm,
        String description) {
}
