# booking-service

TS / Fastify service that owns quote holds, the booking lifecycle state machine, the
event log, and idempotency (MASTER_PLAN §2.2). It owns its own Postgres; cross-service
data (rates) flows through REST contracts only — **never** a cross-database FK.

At this layer only the **data model** exists (the L1 equivalent). Endpoints and the
`BookingStateMachine` arrive at L2.

## Data model (§4.2)

Drizzle schema in `src/db/schema.ts`, three tables:

- **quotes** — a calculated quote snapshot. `lane_id` / `rate_card_id` reference
  rates-service data **by convention only (no hard FK across databases)**; `shipment`
  and `breakdown` are opaque JSONB snapshots; `total_cents` is `bigint`, `currency` is
  `char(3)` (snapshotted, no default).
- **bookings** — `quote_id` is a real FK to `quotes(id)` (same DB, allowed); unique
  `idempotency_key` backs idempotent create.
- **booking_events** — append-only transition log; `from_status`/`to_status` +
  `actor ∈ {user, agent, system}`.

The `quote_status` / `booking_status` enums are intentionally **permissive** — legal
transition ordering is enforced by the L2 `BookingStateMachine` (a single class), never
by a DB CHECK or trigger (one enforcement point, §2.2).

### No seed, by design

Unlike rates-service (reference data with seeded, stable IDs), booking data is
**transactional** — quotes/bookings/events are created at runtime and nothing else
FK-by-conventions against them. So there is no seed script (consistent with ADR-0002:
seed is reference data, not schema).

## Migrations

Generated SQL is committed under `drizzle/` and applied with the drizzle-orm migrator
(`src/db/migrate.ts`) — we never `drizzle-kit push`.

```bash
pnpm db:generate     # regenerate SQL from schema.ts after a schema change
```

Because `booking-db` is on an internal-only network with **no host port** (ADR-0001),
migrations run **inside** the compose network:

```bash
make up               # stack healthy (booking-db reachable only inside the network)
make migrate-booking  # docker compose run --rm --no-deps booking-service node dist/db/migrate.js
```

## Verifying the schema (data-layer DoD)

`migrations apply cleanly` is proven by the Testcontainers integration test
(`test/schema.it.test.ts`, run in CI on native Docker via `pnpm test:integration`;
it may not launch locally on WSL2 + Docker Desktop — CI is the source of truth).

A human can prove the schema against the running stack (host access is via
`docker compose exec`, ADR-0001):

```bash
docker compose exec -T booking-db psql -v ON_ERROR_STOP=1 -U booking -d booking <<'SQL'
WITH q AS (
  INSERT INTO quotes (lane_id, rate_card_id, shipment, breakdown, total_cents, currency, expires_at)
  VALUES (gen_random_uuid(), gen_random_uuid(), '{"origin_code":"CNSHA"}', '[{"component":"BASE","amount_cents":268000}]',
          366540, 'USD', now() + interval '24 hours')
  RETURNING id
), b AS (
  INSERT INTO bookings (quote_id, shipper_ref, idempotency_key)
  SELECT id, 'ACME-001', 'demo-key-1' FROM q
  RETURNING id, status
)
INSERT INTO booking_events (booking_id, from_status, to_status, actor)
SELECT id, NULL, status, 'user' FROM b
RETURNING booking_id, to_status, actor;
SQL
```

Expected: one `booking_events` row with `to_status = QUOTED` (the `bookings` default),
`actor = user` — proving the quote → booking → event chain, the enum defaults, and the
intra-DB FKs. Re-running with the same `idempotency_key` fails on the unique constraint.

## Commands

| Task | Command |
|---|---|
| Build | `pnpm build` |
| Unit tests | `pnpm test` |
| Integration (Testcontainers) | `pnpm test:integration` |
| Lint / Typecheck | `pnpm lint` / `pnpm typecheck` |
| Generate migration SQL | `pnpm db:generate` |
