package com.freightpilot.rates.repository;

import com.freightpilot.rates.domain.Lane;
import com.freightpilot.rates.domain.Mode;
import com.freightpilot.rates.domain.RateCard;
import com.freightpilot.rates.domain.RateUnit;
import com.freightpilot.rates.domain.Surcharge;
import com.freightpilot.rates.domain.SurchargeCalc;
import com.freightpilot.rates.domain.SurchargeType;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * Repository pattern (§4.4) over rate_cards/lanes/surcharges using plain JdbcTemplate — no
 * Spring Data (that's the data-jdbc dependency deliberately avoided). Read-only: rates-service
 * never persists quotes (that's booking-service, §4.2).
 */
@Repository
public class RateCardRepository {

    private static final String CARD_COLUMNS = """
            rc.id AS rc_id, rc.lane_id, rc.base_rate_cents, rc.currency, rc.unit,
            rc.transit_days_min, rc.transit_days_max, rc.valid_from, rc.valid_to,
            l.id AS l_id, l.origin_code, l.origin_name, l.dest_code, l.dest_name, l.mode, l.distance_mi
            """;

    private final JdbcTemplate jdbc;

    public RateCardRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Rate cards on a lane whose validity window contains {@code shipDate}, cheapest first. */
    public List<RateCardDetail> findValidCards(String origin, String dest, Mode mode, LocalDate shipDate) {
        String sql = "SELECT " + CARD_COLUMNS + """
                FROM rate_cards rc
                JOIN lanes l ON l.id = rc.lane_id
                WHERE l.origin_code = ? AND l.dest_code = ? AND l.mode = ?::mode
                  AND ? BETWEEN rc.valid_from AND rc.valid_to
                ORDER BY rc.base_rate_cents ASC
                """;
        return jdbc.query(sql, DETAIL_MAPPER, origin, dest, mode.name(), shipDate);
    }

    /** A single rate card with its lane, if it exists. */
    public Optional<RateCardDetail> findById(UUID rateCardId) {
        String sql = "SELECT " + CARD_COLUMNS + """
                FROM rate_cards rc
                JOIN lanes l ON l.id = rc.lane_id
                WHERE rc.id = ?
                """;
        return jdbc.query(sql, DETAIL_MAPPER, rateCardId).stream().findFirst();
    }

    /** Surcharges attached to a rate card. */
    public List<Surcharge> findSurcharges(UUID rateCardId) {
        // Deterministic order: the breakdown is a cross-service contract (booking snapshots it
        // into quotes.breakdown JSONB, §4.2), so lines must be stable across identical calls.
        String sql = "SELECT id, rate_card_id, type, calc, amount FROM surcharges "
                + "WHERE rate_card_id = ? ORDER BY calc, type, id";
        return jdbc.query(sql, SURCHARGE_MAPPER, rateCardId);
    }

    private static final RowMapper<RateCardDetail> DETAIL_MAPPER = (rs, rowNum) -> {
        Lane lane = new Lane(
                rs.getObject("l_id", UUID.class),
                rs.getString("origin_code"),
                rs.getString("origin_name"),
                rs.getString("dest_code"),
                rs.getString("dest_name"),
                Mode.valueOf(rs.getString("mode")),
                rs.getObject("distance_mi", Integer.class));
        RateCard card = new RateCard(
                rs.getObject("rc_id", UUID.class),
                rs.getObject("lane_id", UUID.class),
                rs.getLong("base_rate_cents"),
                rs.getString("currency").trim(),
                RateUnit.valueOf(rs.getString("unit")),
                rs.getInt("transit_days_min"),
                rs.getInt("transit_days_max"),
                rs.getObject("valid_from", LocalDate.class),
                rs.getObject("valid_to", LocalDate.class));
        return new RateCardDetail(card, lane);
    };

    private static final RowMapper<Surcharge> SURCHARGE_MAPPER = (rs, rowNum) -> new Surcharge(
            rs.getObject("id", UUID.class),
            rs.getObject("rate_card_id", UUID.class),
            SurchargeType.valueOf(rs.getString("type")),
            SurchargeCalc.valueOf(rs.getString("calc")),
            rs.getLong("amount"));
}
