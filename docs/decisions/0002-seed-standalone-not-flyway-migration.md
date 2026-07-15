# ADR-0002: Seed data as a standalone idempotent SQL script, not a Flyway migration

- **Status:** accepted
- **Date:** 2026-07-14
- **Phase/Layer:** Phase 0 / L1 Data (rates-service)
- **Deviates from master plan:** no (L1 DoD asks for `make seed`; the plan does not specify the mechanism)

## Context
L1 adds the rates schema via a Flyway migration (`V1__init.sql`) plus a seed of 16 lanes / 24 rate_cards / 44 surcharges. The question was where the seed lives: inside Flyway's lifecycle (so `make up` populates data too) or as a separate script invoked by `make seed`. architecture-guardian flagged this during the L1 pre-implementation consult. Seed rows also carry the IDs that booking-service references FK-by-convention (§4.2 `quotes.lane_id` / `rate_card_id`), so their stability matters across services.

## Options considered
1. **Flyway repeatable migration (`R__seed.sql`)** — pro: one command (`make up`) builds schema and data; con: couples data to schema lifecycle, reruns on every checksum change, and blurs "schema vs data" — a seed typo would fail app startup.
2. **Standalone `seed.sql` run via `make seed`** — pro: seed is data, not schema, so it stays out of the migration history; runnable/idempotent independently; a bad seed never blocks startup; con: an extra explicit step after `make up`.

## Decision
Keep the seed as a standalone `services/rates/src/main/resources/db/seed/seed.sql` run by `make seed`, separate from Flyway. The script uses fixed UUIDs + `ON CONFLICT (id) DO NOTHING` in a single transaction, so it is idempotent (second run = `INSERT 0 0`, counts unchanged) and never renumbers IDs — which protects the cross-service FK-by-convention contract. Schema changes go through Flyway migrations; data changes go through the seed. `make seed` runs `psql` inside the `rates-db` container per ADR-0001 (the DB has no host port).

## Consequences
- Easier: schema history stays clean (only real DDL versions); a seed typo fails `make seed`, not app startup; the seed can be re-applied or extended without a migration bump.
- Harder / ruled out: `make up` alone does not give you a populated DB — `make seed` is a required second step (documented in the rates README and Makefile).
- Revisit if: L2+ wants tests to auto-seed — that should load the same `seed.sql` from a Testcontainers fixture, not convert it into a Flyway migration.
