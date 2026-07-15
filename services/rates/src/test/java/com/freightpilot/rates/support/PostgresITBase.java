package com.freightpilot.rates.support;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import javax.sql.DataSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Base for integration tests: one shared Postgres (Testcontainers singleton, started once
 * per JVM) that Flyway migrates on context startup. Seed data is applied from the same
 * {@code db/seed/seed.sql} used by {@code make seed} (ADR-0002 directs tests to load the
 * seed file, not a Flyway migration). The seed is idempotent, so applying it per test is safe.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
public abstract class PostgresITBase {

    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("rates")
                    .withUsername("rates")
                    .withPassword("rates_dev");

    static {
        POSTGRES.start();
    }

    @DynamicPropertySource
    static void datasourceProps(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    /** Apply db/seed/seed.sql (idempotent) through a raw connection. */
    protected static void applySeed(DataSource dataSource) throws Exception {
        String sql = new String(
                new ClassPathResource("db/seed/seed.sql").getContentAsByteArray(),
                StandardCharsets.UTF_8);
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }
}
