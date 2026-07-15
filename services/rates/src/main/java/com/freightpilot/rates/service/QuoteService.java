package com.freightpilot.rates.service;

import com.freightpilot.rates.domain.Mode;
import com.freightpilot.rates.domain.QuoteCalculator;
import com.freightpilot.rates.domain.QuoteResult;
import com.freightpilot.rates.domain.ShipmentSpec;
import com.freightpilot.rates.domain.Surcharge;
import com.freightpilot.rates.repository.RateCardDetail;
import com.freightpilot.rates.repository.RateCardRepository;
import com.freightpilot.rates.web.error.RateNotFoundException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Orchestrates rate lookup and quote calculation. Holds no pricing math itself — the
 * strategies + {@link QuoteCalculator} own that. {@code calculate} is a pure read +
 * compute: it NEVER persists (persisting a quote is booking-service, §4.2).
 */
@Service
public class QuoteService {

    private final RateCardRepository repository;
    private final QuoteCalculator calculator;

    public QuoteService(RateCardRepository repository, QuoteCalculator calculator) {
        this.repository = repository;
        this.calculator = calculator;
    }

    /** Rate cards on a lane valid for {@code shipDate}, cheapest first. */
    public List<RateCardDetail> search(String origin, String dest, Mode mode, LocalDate shipDate) {
        return repository.findValidCards(origin, dest, mode, shipDate);
    }

    /** Calculate a full quote for a referenced rate card. 404 if the card does not exist. */
    public CalculatedQuote calculate(UUID rateCardId, ShipmentSpec shipment) {
        RateCardDetail detail = repository.findById(rateCardId)
                .orElseThrow(() -> new RateNotFoundException(rateCardId));
        List<Surcharge> surcharges = repository.findSurcharges(rateCardId);
        QuoteResult result = calculator.calculate(shipment, detail.card(), detail.lane(), surcharges);
        return new CalculatedQuote(detail, result);
    }
}
