# FreightPilot — top-level orchestration.
# Prefer these targets over raw docker/compose commands (CLAUDE.md).
.PHONY: up down restart ps logs seed migrate-booking migrate-agent test evals

COMPOSE ?= docker compose

## up: build + start the stack, block until every healthcheck is green (L0 DoD).
up:
	$(COMPOSE) up -d --build --wait --wait-timeout 180
	@echo ""
	@$(COMPOSE) ps
	@echo ""
	@echo "All services healthy. rates:8080  booking:8081  agent:8082"

## down: stop and remove containers + volumes.
down:
	$(COMPOSE) down -v

restart: down up

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f

## seed: load rates-service demo data. Idempotent (fixed UUIDs + ON CONFLICT DO
## NOTHING), so it's safe to re-run. Runs psql INSIDE the rates-db container per
## ADR-0001 (rates-db has no host port); requires the stack to be up (`make up`).
seed:
	@echo ">> seeding rates-db"
	$(COMPOSE) exec -T rates-db psql -v ON_ERROR_STOP=1 -U rates -d rates \
		< services/rates/src/main/resources/db/seed/seed.sql
	@echo "seed complete (idempotent — safe to re-run)."

## migrate-booking: apply booking-service Drizzle migrations. Runs the migrator INSIDE
## the compose network because booking-db has no host port (ADR-0001); requires `make up`.
migrate-booking:
	@echo ">> applying booking migrations"
	$(COMPOSE) run --rm --no-deps -T booking-service node dist/db/migrate.js
	@echo "booking migrations applied."

## migrate-agent: apply agent-service Drizzle migrations (the confirmations gate table).
## Runs the migrator INSIDE the compose network because agent-db has no host port (ADR-0001);
## requires `make up`. Mirrors migrate-booking.
migrate-agent:
	@echo ">> applying agent migrations"
	$(COMPOSE) run --rm --no-deps -T agent-service node dist/db/migrate.js
	@echo "agent migrations applied."

## test: run each service's hello-world test suite.
test:
	@echo ">> rates-service (maven: unit + Testcontainers ITs)"
	cd services/rates && mvn -B -q verify
	@echo ">> booking-service (vitest)"
	cd services/booking && pnpm install --frozen-lockfile && pnpm test
	@echo ">> agent-service (vitest)"
	cd services/agent && pnpm install --frozen-lockfile && pnpm test

## evals: no-op stub at L0 — the 40-case eval suite lands in L6 (see MASTER_PLAN §7).
evals:
	@echo "make evals: no eval cases yet (eval suite arrives in L6)."
