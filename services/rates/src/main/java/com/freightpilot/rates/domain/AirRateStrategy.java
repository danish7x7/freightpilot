package com.freightpilot.rates.domain;

import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.stereotype.Component;

/**
 * Air: priced per kg of CHARGEABLE weight = max(actual_kg, volumetric_kg), where
 * volumetric_kg = volume_cbm × 167 (IATA 1:6000, see docs/domain-notes.md). If no volume
 * is given, chargeable weight is the actual weight. The chargeable weight is computed
 * exactly (no intermediate rounding); only the resulting cents are rounded HALF_UP.
 * All arithmetic is BigDecimal — never double (hard rule §7).
 */
@Component
public class AirRateStrategy implements RateStrategy {

    /** IATA volumetric factor: 1 cbm = 167 kg. */
    static final BigDecimal VOLUMETRIC_FACTOR = new BigDecimal("167");

    @Override
    public Mode mode() {
        return Mode.AIR;
    }

    @Override
    public long baseCostCents(ShipmentSpec shipment, RateCard card, Lane lane) {
        Cargo cargo = shipment.cargo();
        BigDecimal actual = cargo.weightKg();
        BigDecimal volumetric = cargo.volumeCbm() == null
                ? BigDecimal.ZERO
                : cargo.volumeCbm().multiply(VOLUMETRIC_FACTOR);
        BigDecimal chargeableKg = actual.max(volumetric);
        return BigDecimal.valueOf(card.baseRateCents())
                .multiply(chargeableKg)
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
    }
}
