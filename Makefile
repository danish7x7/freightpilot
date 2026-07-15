# FreightPilot — top-level orchestration.
# Prefer these targets over raw docker/compose commands (CLAUDE.md).
.PHONY: up down restart ps logs seed test evals

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

## seed: no-op stub at L0 — real seed data lands in L1 (see MASTER_PLAN §3).
seed:
	@echo "make seed: nothing to seed yet (schemas + seed data arrive in L1)."

## test: run each service's hello-world test suite.
test:
	@echo ">> rates-service (maven)"
	cd services/rates && mvn -B -q test
	@echo ">> booking-service (vitest)"
	cd services/booking && pnpm install --frozen-lockfile && pnpm test
	@echo ">> agent-service (vitest)"
	cd services/agent && pnpm install --frozen-lockfile && pnpm test

## evals: no-op stub at L0 — the 40-case eval suite lands in L6 (see MASTER_PLAN §7).
evals:
	@echo "make evals: no eval cases yet (eval suite arrives in L6)."
