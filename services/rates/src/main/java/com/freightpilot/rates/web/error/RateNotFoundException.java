package com.freightpilot.rates.web.error;

import java.util.UUID;

/** Thrown when a referenced rate card does not exist → 404 RATE_NOT_FOUND. */
public class RateNotFoundException extends RuntimeException {

    public RateNotFoundException(UUID rateCardId) {
        super("No rate card with id " + rateCardId);
    }
}
