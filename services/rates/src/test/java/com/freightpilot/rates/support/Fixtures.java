package com.freightpilot.rates.support;

import com.freightpilot.rates.domain.Cargo;
import com.freightpilot.rates.domain.Lane;
import com.freightpilot.rates.domain.Mode;
import com.freightpilot.rates.domain.RateCard;
import com.freightpilot.rates.domain.RateUnit;
import com.freightpilot.rates.domain.ShipmentSpec;
import com.freightpilot.rates.domain.Surcharge;
import com.freightpilot.rates.domain.SurchargeCalc;
import com.freightpilot.rates.domain.SurchargeType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/** Builders for domain objects in unit tests — no Spring, no DB. */
public final class Fixtures {

    private static final LocalDate FROM = LocalDate.parse("2026-01-01");
    private static final LocalDate TO = LocalDate.parse("2026-12-31");

    private Fixtures() {
    }

    public static RateCard card(long baseRateCents, RateUnit unit) {
        return new RateCard(UUID.randomUUID(), UUID.randomUUID(), baseRateCents, "USD", unit, 14, 20, FROM, TO);
    }

    public static Lane lane(Mode mode, Integer distanceMi) {
        return new Lane(UUID.randomUUID(), "CNSHA", "Shanghai", "USOAK", "Oakland", mode, distanceMi);
    }

    /** Shipment with the given actual weight (kg) and optional volume (cbm), as strings for exactness. */
    public static ShipmentSpec shipment(String weightKg, String volumeCbm) {
        return new ShipmentSpec(
                "CNSHA", "USOAK", null, LocalDate.parse("2026-08-01"), null,
                new Cargo(null, new BigDecimal(weightKg),
                        volumeCbm == null ? null : new BigDecimal(volumeCbm), "test cargo"));
    }

    public static Surcharge flat(SurchargeType type, long cents) {
        return new Surcharge(UUID.randomUUID(), UUID.randomUUID(), type, SurchargeCalc.FLAT, cents);
    }

    public static Surcharge percent(SurchargeType type, long basisPoints) {
        return new Surcharge(UUID.randomUUID(), UUID.randomUUID(), type, SurchargeCalc.PERCENT, basisPoints);
    }
}
