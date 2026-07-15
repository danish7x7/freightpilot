package com.freightpilot.rates.web.dto;

import com.freightpilot.rates.domain.Cargo;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/**
 * Request cargo (§5 ShipmentSpec.cargo). Validated at the boundary, then mapped to domain.
 * {@code @Digits} bounds the precision/scale of the decimal fields: without it a short JSON
 * literal with a huge exponent (e.g. {@code 1E1000000000}) parses to a BigDecimal whose later
 * {@code setScale} would allocate gigabytes — an unauthenticated single-request DoS.
 */
public record CargoDto(
        @Min(1) @Max(100) Integer pallets,
        @NotNull @DecimalMin(value = "0", inclusive = false) @DecimalMax("30000")
        @Digits(integer = 5, fraction = 3) BigDecimal weightKg,
        @DecimalMin(value = "0", inclusive = false) @DecimalMax("100000")
        @Digits(integer = 6, fraction = 4) BigDecimal volumeCbm,
        @NotNull @Size(max = 500) String description) {

    public Cargo toDomain() {
        return new Cargo(pallets, weightKg, volumeCbm, description);
    }
}
