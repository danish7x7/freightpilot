# rates-service

Owns lanes, rate cards, surcharges, and (from L2) quote calculation. Java 21 / Spring Boot 3 / Postgres / Flyway. See `docs/MASTER_PLAN.md` §4.1 for the data model.

## Data layer (L1)

- **Schema** — Flyway migrations in `src/main/resources/db/migration/` (`V1__init.sql`). Flyway runs on app startup against `rates-db`; a failed migration fails startup (the container stays unhealthy).
- **Seed** — `src/main/resources/db/seed/seed.sql`, applied by `make seed`, **not** by Flyway. Seed is data, not schema. Idempotent: fixed UUIDs + `ON CONFLICT (id) DO NOTHING`. ~16 lanes across ocean/air/truck; busy ocean lanes have 2–3 overlapping validity windows. Magnitudes: `docs/domain-notes.md`.

### Run it

```bash
make up      # brings up rates-service (runs migrations) + rates-db
make seed    # loads seed.sql (safe to re-run)
```

`rates-db` has no host port (ADR-0001); reach it with `docker compose exec rates-db psql -U rates -d rates`.

## Documented query — L1 DoD

"Cheapest ocean CNSHA→USOAK valid on 2026-08-01." At L1 this is base-rate level (surcharge-inclusive totals are quote calc, L2). The point of the query is the overlapping-window date filter — three cards on this lane are valid on that date; the annual base card is cheapest.

```bash
docker compose exec -T rates-db psql -U rates -d rates -c "
  SELECT rc.id, rc.base_rate_cents, rc.transit_days_min, rc.transit_days_max,
         rc.valid_from, rc.valid_to
  FROM rate_cards rc
  JOIN lanes l ON l.id = rc.lane_id
  WHERE l.origin_code = 'CNSHA' AND l.dest_code = 'USOAK' AND l.mode = 'OCEAN'
    AND DATE '2026-08-01' BETWEEN rc.valid_from AND rc.valid_to
  ORDER BY rc.base_rate_cents ASC
  LIMIT 1;"
```

Expected: rate card `2222…-001`, `base_rate_cents = 268000` ($2,680.00), transit 18–22 days, window 2026-01-01 → 2026-12-31.
