package com.freightpilot.rates.web.dto;

import com.freightpilot.rates.domain.Mode;
import com.freightpilot.rates.domain.ShipmentSpec;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** Request shipment (§5 ShipmentSpec). `mode`/`deliverBy` optional; mapped to domain. */
public record ShipmentSpecDto(
        @NotNull @Size(min = 5, max = 5) String originCode,
        @NotNull @Size(min = 5, max = 5) String destCode,
        Mode mode,
        @NotNull LocalDate shipDate,
        LocalDate deliverBy,
        @NotNull @Valid CargoDto cargo) {

    public ShipmentSpec toDomain() {
        return new ShipmentSpec(originCode, destCode, mode, shipDate, deliverBy, cargo.toDomain());
    }
}
