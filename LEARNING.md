# LEARNING.md — FreightPilot

Append-only. Maintained by the scribe agent at session end. Each entry ≤5 lines, phrased so it can be said out loud in an interview. Newest at top within each section.

Format:
```
### YYYY-MM-DD — <topic>
**What I learned:** ...
**How I hit it:** ...
**Why it matters / where it transfers:** ...
```

---

## Spring Boot / Java

### 2026-07-14 — @DecimalMax doesn't stop a BigDecimal DoS; bound scale with @Digits
**What I learned:** Jackson's max-number-length guard counts characters, so a ~12-char literal like `1E1000000000` slips through and parses to a BigDecimal with scale ≈ -1e9; a later `setScale(0)` then tries to materialize a ~10^9-digit integer → multi-GB allocation. `@DecimalMax` checks the value but not the precision, so it doesn't help; `@Digits(integer, fraction)` rejects the pathological scale cheaply *before* the math runs.
**How I hit it:** security-reviewer flagged it HIGH pre-merge — an attacker gets a valid AIR rate_card_id from public `/rates/search`, then POSTs that crafted `volume_cbm` to `/quotes/calculate`; the air chargeable-weight math would OOM. Fixed with `@Digits` on the decimal DTO fields; crafted payload now returns 400, no OOM.
**Why it matters / where it transfers:** For any BigDecimal that feeds scale-sensitive math, bound precision/scale, not just magnitude — the danger is the exponent, and a short string can encode an enormous one.

### 2026-07-14 — Flyway-on-startup gives you readiness for free
**What I learned:** Running Flyway inside the app's startup (the default Spring Boot wiring) means a failed migration fails the boot, so the container never reports healthy.
**How I hit it:** I considered decoupling migration from startup, but keeping it inline means a bad V-migration → app won't start → container stays unhealthy → `make up --wait` blocks — no separate readiness check needed.
**Why it matters / where it transfers:** Fail-fast at boot turns "is the schema ready?" into the same signal as "is the app up?" — one health gate instead of two, and no window where the app serves against a half-migrated DB.

### 2026-07-14 — Spring's datasource wants a jdbc: URL, not a postgres:// URI
**What I learned:** Spring Boot cannot parse a `postgres://user:pass@host/db` connection URI into a DataSource; it needs `SPRING_DATASOURCE_URL=jdbc:postgresql://...` plus separate username/password.
**How I hit it:** The L0 compose passed `RATES_DATABASE_URL=postgres://...` (fine for node/Drizzle); guardian flagged it as a must-fix when rates got a real datasource — the URI form would have failed at boot.
**Why it matters / where it transfers:** "Database URL" isn't one format — the node ecosystem eats libpq URIs, the JDBC world wants `jdbc:` + split creds. Per-service env has to speak each stack's dialect, not a shared assumption.

## TypeScript / Node / Fastify

### 2026-07-14 — Pin the build tool to your test runner's major
**What I learned:** When a test runner owns a peer of a build tool, pin the build tool to the runner's major or you get two copies in the tree with incompatible types.
**How I hit it:** client had `vite@6` as a direct devDep while vitest@2.1 + @vitejs/plugin-react pulled `vite@5`; the two Vite `Plugin` types clashed and `tsc --noEmit` failed with a deep TS2769 overload error — tests and build were fine, only typecheck broke.
**Why it matters / where it transfers:** Dual-version type clashes surface at typecheck, not runtime — so a green test run hides them. Fix was pinning client Vite to ^5.4.11 to match vitest's own Vite. General rule for any runner-owns-a-peer relationship.

## LLM Engineering (providers, tool calling, prompts)

## Evals & Testing

## Data & Domain (freight, Postgres, money/date handling)

### 2026-07-14 — Make the breakdown sum to the total by construction, not by luck
**What I learned:** Composing a money total as base + surcharges is robust only if each line rounds independently (HALF_UP to integer cents), percents are taken off the base (not a running total), and the breakdown lines are defined to sum exactly to the total — that also makes the result order-independent.
**How I hit it:** L2 quote calculation (ADR-0003): I chose percent-of-base over percent-of-running-total so surcharge order can't change the price, and asserted in tests that the breakdown lines add up to `total_cents` exactly, with everything in BigDecimal/integer — no `double`.
**Why it matters / where it transfers:** A breakdown that doesn't reconcile to its total is a bug the user sees; booking-service has to re-derive the same number across the service boundary, so order-independence + fixed rounding make the contract reproducible instead of fragile.

### 2026-07-14 — Seed realistic ambiguity so a query can't pass trivially
**What I learned:** Giving the busy ocean lanes 2-3 OVERLAPPING validity windows makes the "cheapest valid on DATE" query actually exercise its date-range filter — three cards are valid on the test date, not one.
**How I hit it:** The L1 DoD query for CNSHA→USOAK returns card …001 at $2,680, but only because the filter picks it out of 3 overlapping candidates; with one card per lane the query would pass even if the date logic were broken.
**Why it matters / where it transfers:** Seed data is a test fixture — if it has no ambiguity, a "passing" query proves nothing. Same lesson as writing a test whose input can distinguish the right implementation from a stub.

### 2026-07-14 — Seed is data, not schema: keep it out of migrations and make it idempotent
**What I learned:** A seed belongs in a standalone script (fixed UUIDs + `ON CONFLICT (id) DO NOTHING`, one transaction), not in a Flyway migration — a second run is `INSERT 0 0` and IDs never move.
**How I hit it:** Chose `make seed` over an `R__seed.sql` repeatable migration (ADR-0002); stable IDs matter because booking-service references rates IDs FK-by-convention across service boundaries.
**Why it matters / where it transfers:** Mixing seed into migrations makes a data typo fail app startup and lets IDs churn. Separating schema-lifecycle from data-lifecycle keeps migration history honest and cross-service references stable.

## Ops (Docker, CI/CD, AWS, observability)

### 2026-07-14 — Testcontainers needs a real Docker API, not Docker Desktop's CLI proxy (WSL2)
**What I learned:** On WSL2 with Docker Desktop, `/var/run/docker.sock` is a CLI proxy (labels `com.docker.desktop.address=...docker-cli.sock`); the `docker` CLI negotiates an API version and works, but docker-java (what Testcontainers uses) hits `/info` un-negotiated and gets HTTP 400, so the ITs can't start a container locally.
**How I hit it:** L2 `*IT` Testcontainers tests failed to launch locally despite `docker` commands working; the compose stack was fine. The ITs compile and their singleton-container + `@DynamicPropertySource` + seed-loading pattern was confirmed sound — they run on CI's native Docker.
**Why it matters / where it transfers:** "docker CLI works" doesn't imply "the Docker API client works" — programmatic Docker clients can fail where the CLI succeeds. When the local daemon is a proxy, verify the equivalent behavior another way (I checked the same cases against the live compose stack) and let CI's native Docker be the source of truth.

### 2026-07-14 — Docker `internal: true` networks can't publish host ports
**What I learned:** A container on an `internal: true` network cannot publish a host port — the mapping is accepted but silently dead.
**How I hit it:** Put per-service Postgres on internal-only nets for isolation but also mapped 5433-5435 for dev `psql`; the ports never bound and I only noticed during verification.
**Why it matters / where it transfers:** "Accepted config" isn't "working config" — verify the property, don't trust the YAML. Host DB access moved to `docker compose exec <db> psql` (ADR-0001).

### 2026-07-14 — Enforce architecture rules by network construction, not discipline
**What I learned:** The "each service owns its DB" rule becomes a physical fact if you simply don't attach a service to another service's DB network.
**How I hit it:** agent-service is on `backend` + `agent_db_net` only; verified agent→rates-db TCP connect times out (unroutable) while agent→rates-service:8080/health succeeds.
**Why it matters / where it transfers:** Turning a written rule into "impossible to violate by construction" is stronger than a lint or a code review — same idea as making an invalid booking state transition a type error.

## Process (what worked / what didn't in the build workflow)

### 2026-07-14 — Validate CI jobs in throwaway containers when the host lacks the toolchain
**What I learned:** You can prove each CI job passes without the toolchain installed locally by running it in the same base image CI uses.
**How I hit it:** No pnpm/mvn/java21 on the host, so I ran booking/agent/client in Node containers and rates in maven:3.9-eclipse-temurin-21 — this is exactly how the Vite typecheck clash got caught before commit rather than in CI.
**Why it matters / where it transfers:** Reproduces CI locally with zero host pollution and shifts failures left; the container IS the environment, so "works in the container" transfers to "works in CI."

---

<!-- Example entry (delete once real ones exist):

### 2026-07-15 — Gemini vs OpenAI tool-call shapes
**What I learned:** Gemini returns function calls in a different envelope than the OpenAI schema; args arrive already-parsed vs JSON strings.
**How I hit it:** Adapter smoke test passed on Groq, failed on Gemini with the same prompt.
**Why it matters / where it transfers:** Normalizing at the adapter boundary means the agent loop stays provider-blind — same reason you normalize at repository boundaries for databases.
-->
