package com.freightpilot.rates.web;

import com.freightpilot.rates.domain.Mode;
import com.freightpilot.rates.service.QuoteService;
import com.freightpilot.rates.web.dto.CalculateRequest;
import com.freightpilot.rates.web.dto.QuoteResponse;
import com.freightpilot.rates.web.dto.RateCardView;
import com.freightpilot.rates.web.dto.SearchResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Rates API (contracts/rates.openapi.yaml). Thin: it validates/binds and delegates to
 * {@link QuoteService}; no business logic here.
 */
@RestController
@RequestMapping("/api/v1")
@Validated
public class RatesController {

    private final QuoteService quoteService;

    public RatesController(QuoteService quoteService) {
        this.quoteService = quoteService;
    }

    /** Rate cards valid for a ship date on a lane (may be several — overlapping windows). */
    @GetMapping("/rates/search")
    public SearchResponse search(
            @RequestParam @Size(min = 5, max = 5) String origin,
            @RequestParam @Size(min = 5, max = 5) String dest,
            @RequestParam Mode mode,
            @RequestParam("ship_date") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate shipDate) {
        var views = quoteService.search(origin, dest, mode, shipDate).stream()
                .map(RateCardView::from)
                .toList();
        return new SearchResponse(views);
    }

    /** Full quote calculation with surcharge breakdown. Pure — persists nothing. */
    @PostMapping("/quotes/calculate")
    public QuoteResponse calculate(@Valid @RequestBody CalculateRequest request) {
        var quote = quoteService.calculate(request.rateCardId(), request.shipment().toDomain());
        return QuoteResponse.from(quote);
    }
}
