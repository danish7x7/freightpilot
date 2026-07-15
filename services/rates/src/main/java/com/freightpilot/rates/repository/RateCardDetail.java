package com.freightpilot.rates.repository;

import com.freightpilot.rates.domain.Lane;
import com.freightpilot.rates.domain.RateCard;

/** A rate card together with its lane — the shape rate lookups return. */
public record RateCardDetail(RateCard card, Lane lane) {
}
