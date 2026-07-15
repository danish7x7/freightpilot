package com.freightpilot.rates.domain;

/**
 * Strategy pattern (§4.4): one implementation per {@link Mode} computes the base cost
 * in integer cents. Polymorphism beats a switch-on-mode — each mode's chargeable-unit
 * logic (containers vs chargeable weight vs miles) lives in its own type, and a new mode
 * is a new class, not another branch. Implementations are pure and Spring-free so they
 * unit-test without a context.
 */
public interface RateStrategy {

    /** The mode this strategy handles. */
    Mode mode();

    /** Base cost in integer cents, before surcharges. */
    long baseCostCents(ShipmentSpec shipment, RateCard card, Lane lane);
}
