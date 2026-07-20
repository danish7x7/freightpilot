package com.freightpilot.rates;

import static org.assertj.core.api.Assertions.assertThat;

import com.freightpilot.rates.support.PostgresITBase;
import com.jayway.jsonpath.JsonPath;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/** Exercises the real endpoints against Flyway-migrated, seeded Postgres. */
class QuoteApiIT extends PostgresITBase {

    private static final String OCEAN_CARD = "22222222-2222-2222-2222-000000000001";
    private static final String OCEAN_LANE = "11111111-1111-1111-1111-000000000001";
    private static final String AIR_CARD = "22222222-2222-2222-2222-000000000016";
    private static final String TRUCK_CARD = "22222222-2222-2222-2222-000000000021";
    private static final String MISSING_CARD = "22222222-2222-2222-2222-000000009999";

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private DataSource dataSource;

    @BeforeEach
    void seed() throws Exception {
        applySeed(dataSource);
    }

    @Test
    void searchReturnsOverlappingOceanCardsCheapestFirst() {
        String body = rest.getForObject(
                "/api/v1/rates/search?origin=CNSHA&dest=USOAK&mode=OCEAN&ship_date=2026-08-01", String.class);
        List<?> cards = JsonPath.read(body, "$.rate_cards");
        assertThat(cards).hasSize(3);
        assertThat(((Number) JsonPath.read(body, "$.rate_cards[0].base_rate_cents")).longValue())
                .isEqualTo(268_000L);
        assertThat((String) JsonPath.read(body, "$.rate_cards[0].currency")).isEqualTo("USD");
    }

    @Test
    void calculateOceanQuoteComposesSurcharges() {
        // base 268000 + FUEL 15.5% (41540) + PEAK_SEASON 45000 + SECURITY 12000 = 366540
        var response = post(OCEAN_CARD, Map.of(
                "origin_code", "CNSHA", "dest_code", "USOAK", "mode", "OCEAN", "ship_date", "2026-08-01",
                "cargo", Map.of("weight_kg", 12000, "description", "flat-screen panels")));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        String body = response.getBody();
        assertThat(((Number) JsonPath.read(body, "$.base_cost_cents")).longValue()).isEqualTo(268_000L);
        assertThat(((Number) JsonPath.read(body, "$.total_cents")).longValue()).isEqualTo(366_540L);
        assertThat((List<?>) JsonPath.read(body, "$.breakdown")).hasSize(4);
        assertThat((String) JsonPath.read(body, "$.mode")).isEqualTo("OCEAN");
        // lane_id is emitted from the quoted card's own FK (card.laneId()) so the (rate_card_id,
        // lane_id) pair the client forwards into booking cannot diverge. Card …001 is on lane …001.
        assertThat((String) JsonPath.read(body, "$.rate_card_id")).isEqualTo(OCEAN_CARD);
        assertThat((String) JsonPath.read(body, "$.lane_id")).isEqualTo(OCEAN_LANE);
    }

    @Test
    void searchExcludesCardsOutsideTheValidityWindow() {
        // On 2026-01-15 only the annual card (…001) is valid; the two seasonal cards
        // (06-01 and 07-15 onwards) are excluded — proving the date filter excludes, not just includes.
        String body = rest.getForObject(
                "/api/v1/rates/search?origin=CNSHA&dest=USOAK&mode=OCEAN&ship_date=2026-01-15", String.class);
        assertThat((List<?>) JsonPath.read(body, "$.rate_cards")).hasSize(1);
        assertThat(((Number) JsonPath.read(body, "$.rate_cards[0].base_rate_cents")).longValue())
                .isEqualTo(268_000L);
    }

    @Test
    void searchUnknownLaneReturnsEmpty() {
        String body = rest.getForObject(
                "/api/v1/rates/search?origin=ZZZZZ&dest=USOAK&mode=OCEAN&ship_date=2026-08-01", String.class);
        assertThat((List<?>) JsonPath.read(body, "$.rate_cards")).isEmpty();
    }

    @Test
    void calculateTruckQuoteUsesLaneDistance() {
        // base 265c/mi * 372 mi = 98580; + FUEL 12% (11830) + HANDLING 7500 = 117910
        var response = post(TRUCK_CARD, Map.of(
                "origin_code", "USOAK", "dest_code", "USLAX", "mode", "TRUCK", "ship_date", "2026-08-01",
                "cargo", Map.of("weight_kg", 18000, "description", "palletized freight")));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(((Number) JsonPath.read(response.getBody(), "$.base_cost_cents")).longValue())
                .isEqualTo(98_580L);
        assertThat(((Number) JsonPath.read(response.getBody(), "$.total_cents")).longValue())
                .isEqualTo(117_910L);
    }

    @Test
    void calculateAirQuoteUsesChargeableWeight() {
        // chargeable = max(800, 3*167=501) = 800; base 520c/kg*800 = 416000
        // + FUEL 18% (74880) + SECURITY 8000 = 498880
        var response = post(AIR_CARD, Map.of(
                "origin_code", "HKHKG", "dest_code", "USLAX", "mode", "AIR", "ship_date", "2026-08-01",
                "cargo", Map.of("weight_kg", 800, "volume_cbm", 3, "description", "electronics")));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(((Number) JsonPath.read(response.getBody(), "$.base_cost_cents")).longValue())
                .isEqualTo(416_000L);
        assertThat(((Number) JsonPath.read(response.getBody(), "$.total_cents")).longValue())
                .isEqualTo(498_880L);
    }

    @Test
    void unknownRateCardReturns404Envelope() {
        var response = post(MISSING_CARD, Map.of(
                "origin_code", "CNSHA", "dest_code", "USOAK", "mode", "OCEAN", "ship_date", "2026-08-01",
                "cargo", Map.of("weight_kg", 12000, "description", "cargo")));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat((String) JsonPath.read(response.getBody(), "$.code")).isEqualTo("RATE_NOT_FOUND");
        assertThat((List<?>) JsonPath.read(response.getBody(), "$.details")).isNotNull();
    }

    @Test
    void invalidCargoReturns400ValidationEnvelope() {
        var response = post(OCEAN_CARD, Map.of(
                "origin_code", "CNSHA", "dest_code", "USOAK", "mode", "OCEAN", "ship_date", "2026-08-01",
                "cargo", Map.of("weight_kg", 0, "description", "cargo"))); // weight must be > 0
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat((String) JsonPath.read(response.getBody(), "$.code")).isEqualTo("VALIDATION_ERROR");
    }

    private ResponseEntity<String> post(String rateCardId, Map<String, Object> shipment) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        var request = new HttpEntity<>(Map.of("rate_card_id", rateCardId, "shipment", shipment), headers);
        return rest.postForEntity("/api/v1/quotes/calculate", request, String.class);
    }
}
