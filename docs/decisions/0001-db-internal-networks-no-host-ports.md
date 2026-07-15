# ADR-0001: Per-service Postgres on internal-only networks, no host port publishing

- **Status:** accepted
- **Date:** 2026-07-14
- **Phase/Layer:** Phase 0 / L0 Foundation
- **Deviates from master plan:** no (reinforces §2.2 "each service owns its database"; adds a defense-in-depth detail the plan does not specify)

## Context
L0 stands up three per-service Postgres instances in docker-compose. The initial skeleton published dev-convenience host ports (5433-5435) so a developer could `psql` from the host. During verification we found each DB container also sits on a `internal: true` Docker network for service isolation — and internal networks cannot publish host ports, so those mappings were silently dead config. This forced a choice on how DB isolation and host access should actually work.

## Options considered
1. **Publish host ports on a normal (non-internal) DB network** — pro: `psql host:5433` works for devs; con: DBs reachable from the host and from any container on that net, weakening the "each service owns its DB" boundary to convention only.
2. **Internal-only DB networks, no host ports** — pro: a DB is reachable *only* by its owning app service (segmentation enforced by network attachment, not discipline); con: host DB access now requires `docker compose exec <db> psql`.

## Decision
Keep each Postgres on its own `internal: true` network with no host port publishing; host access is via `docker compose exec <db> psql`. The architecture rule that a service owns its DB is then enforced by construction — agent-service is not attached to `rates_db_net`, so agent→rates-db is physically unroutable (verified: the TCP connect times out, while agent→rates-service:8080/health over the shared `backend` net succeeds). The minor loss of `psql`-from-host convenience is worth the honest, verifiable boundary.

## Consequences
- Easier: the §2.2 ownership rule stops being a promise and becomes a network fact; cross-service DB access is impossible to write by accident.
- Harder / ruled out: no direct host DB tooling on a published port; devs use `docker compose exec` (documented in the journal). GUI DB clients on the host would need an ad-hoc port-forward.
- Revisit if: a later layer needs host-side DB tooling for many services, or if we move to a compose profile that publishes ports only in an explicit `dev` profile.
