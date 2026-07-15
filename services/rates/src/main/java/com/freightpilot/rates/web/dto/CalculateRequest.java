package com.freightpilot.rates.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.UUID;

/** Body of POST /api/v1/quotes/calculate: a rate card reference + the shipment (§5). */
public record CalculateRequest(
        @NotNull UUID rateCardId,
        @NotNull @Valid ShipmentSpecDto shipment) {
}
