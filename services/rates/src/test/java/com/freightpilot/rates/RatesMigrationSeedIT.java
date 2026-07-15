package com.freightpilot.rates;

import static org.assertj.core.api.Assertions.assertThat;

import com.freightpilot.rates.support.PostgresITBase;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Guards the L1 data layer end to end (the L1→L2 handoff condition): Flyway migration applies,
 * the seed loads, the DoD query returns the expected card, and re-seeding is idempotent. This is
 * what catches a future V2 breaking V1, a seed typo, or enum-literal drift.
 */
class RatesMigrationSeedIT extends PostgresITBase {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private DataSource dataSource;

    @Test
    void flywayMigrationApplied() {
        Integer applied = jdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE version = '1' AND success", Integer.class);
        assertThat(applied).isEqualTo(1);
    }

    @Test
    void seedLoadsIsIdempotentAndAnswersDodQuery() throws Exception {
        applySeed(dataSource);
        assertRowCounts();

        // DoD query: cheapest ocean CNSHA->USOAK valid on 2026-08-01
        Long cheapest = jdbc.queryForObject("""
                SELECT rc.base_rate_cents FROM rate_cards rc JOIN lanes l ON l.id = rc.lane_id
                WHERE l.origin_code = 'CNSHA' AND l.dest_code = 'USOAK' AND l.mode = 'OCEAN'
                  AND DATE '2026-08-01' BETWEEN rc.valid_from AND rc.valid_to
                ORDER BY rc.base_rate_cents ASC LIMIT 1
                """, Long.class);
        assertThat(cheapest).isEqualTo(268_000L);

        Integer overlapping = jdbc.queryForObject("""
                SELECT count(*) FROM rate_cards rc JOIN lanes l ON l.id = rc.lane_id
                WHERE l.origin_code = 'CNSHA' AND l.dest_code = 'USOAK' AND l.mode = 'OCEAN'
                  AND DATE '2026-08-01' BETWEEN rc.valid_from AND rc.valid_to
                """, Integer.class);
        assertThat(overlapping).isEqualTo(3); // the date filter is load-bearing, not a single-row lookup

        // idempotency: applying seed again changes nothing
        applySeed(dataSource);
        assertRowCounts();
    }

    private void assertRowCounts() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM lanes", Integer.class)).isEqualTo(16);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM rate_cards", Integer.class)).isEqualTo(24);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM surcharges", Integer.class)).isEqualTo(44);
    }
}
