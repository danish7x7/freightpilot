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

## Domain + API (L2)

Contract: `contracts/rates.openapi.yaml` (written before the controllers, per §5). JSON is snake_case; money is always integer cents.

### Endpoints

- `GET /api/v1/rates/search?origin&dest&mode&ship_date` — rate cards whose validity window contains `ship_date`, cheapest first.
- `POST /api/v1/quotes/calculate` — `{ rate_card_id, shipment }` → base cost + surcharge breakdown + total. **Pure: persists nothing** (persisting a quote is booking-service, §4.2). Unknown card → `404 RATE_NOT_FOUND`.

Errors use the uniform envelope `{code, message, details[]}`; every response echoes/​mints `X-Request-Id`.

### Pricing (Strategy pattern, §4.4)

One `RateStrategy` per mode computes the **base cost**; a single `QuoteCalculator` composes surcharges. Strategies are pure (no Spring) and unit-tested directly.

| Mode | Base cost |
|---|---|
| OCEAN | `base_rate_cents × 1` (single FEU; multi-container is future) |
| AIR | `base_rate_cents × chargeable_kg`, `chargeable = max(actual, volume_cbm × 167)` (IATA 1:6000), rounded HALF_UP |
| TRUCK | `base_rate_cents × lane.distance_mi` |

### Surcharge composition (documented ordering)

Every surcharge is computed against the **base cost**: `FLAT` adds fixed cents; `PERCENT` adds `base × bps/10000`, rounded HALF_UP per line. Because both reference the base (never each other's output), **order is immaterial by construction** — matching real BAF/fuel ("percent of base", `docs/domain-notes.md`). Breakdown lines sum exactly to `total_cents` (§4.2).

Example (ocean card `…001`, base 268000): FUEL 15.5% → 41540, PEAK_SEASON → 45000, SECURITY → 12000; **total 366540**.

### Tests

- Unit (Surefire, `mvn test`) — pure JUnit per strategy (incl. all three air chargeable-weight branches, truck's illegal null-distance) and surcharge composition/rounding. No Spring, no DB.
- Integration (Failsafe `*IT`, `mvn verify`) — Testcontainers Postgres runs Flyway + loads `seed.sql`, then asserts the migration/seed/DoD-query/idempotency and drives the real endpoints.

