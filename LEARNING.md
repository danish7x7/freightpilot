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

### 2026-07-16 — Idempotency short-circuits must precede business preconditions — and only integration tests prove it
**What I learned:** A replay of an `Idempotency-Key` must return the original result BEFORE any business precondition runs, because on replay the world has already moved on — the quote that was HELD is now CONSUMED, so a precondition check runs first would reject a valid replay. Unit tests can't see this; you have to exercise the real replay against a real DB.
**How I hit it:** booking L2 — running the Testcontainers IT (not just unit + typecheck) surfaced a create-idempotency bug: the quote-HELD precondition ran ahead of the idempotency short-circuit, so replaying a consumed key errored instead of returning the original booking.
**Why it matters / where it transfers:** Idempotency is an ordering property, not just a unique constraint — the replay path must bypass state that the first write legitimately changed. Integration tests earn their cost by catching ordering bugs unit tests structurally cannot.

### 2026-07-16 — A "single enforcement point" is only as good as its from×to test matrix
**What I learned:** Claiming one class is the single place a state transition can happen is a claim you have to prove exhaustively: the full N×N matrix of every legal AND illegal (from, to) pair, plus null-birth (INITIAL) and every terminal state. Anything less and an illegal edge can slip through unasserted.
**How I hit it:** booking L2 `BookingStateMachine` — 49 pure unit tests cover the complete 6×6 transition matrix + birth + terminal, so "invalid transition = typed 409" is proven for every pair, not just the happy path.
**Why it matters / where it transfers:** Invariant-enforcing code needs invariant-shaped tests — enumerate the whole space, don't sample it. Same discipline as testing every branch of a validator, not just the one the feature uses.

### 2026-07-15 — A mocked-network E2E only stays honest if its fixtures are typed against the contract
**What I learned:** A Playwright happy-path that mocks the network is only trustworthy if the mock fixtures are TYPED against the generated contract (`rates.gen.ts`) — then any contract drift breaks the test at compile time (tsc), not silently at runtime. Untyped JSON fixtures will happily lie about matching the real API.
**How I hit it:** L4 rates-half E2E — I typed the mocked responses against the L3-generated types so the fake network can't drift from the spec without breaking the build.
**Why it matters / where it transfers:** A mock is a claim about a real dependency; type it against the source of truth or it decays into fiction. Same reason you generate the client from the contract instead of hand-rolling it.

### 2026-07-15 — Regression-guard the enforcement rule, not just the code it checks
**What I learned:** I encoded the §5 house conventions (error-envelope `$ref`, `X-Request-Id` header) as two custom spectral rules, then wrote a deliberately-broken negative fixture + a self-test asserting BOTH rules fire. A rule that stops firing (edited, disabled, mis-scoped) fails silently and drops enforcement with the gate still green.
**How I hit it:** L3 contract tooling — added `contracts/test/negative.openapi.yaml` + `ruleset-selftest.mjs` wired into CI as `pnpm test:ruleset`, alongside the real lint that must be genuinely clean (`--fail-severity=warn`).
**Why it matters / where it transfers:** A linter/eval/guard is itself untested code — same failure class as a weak eval that passes a stub. If a rule protects an invariant, prove the rule can still fail on a known-bad input.

## Data & Domain (freight, Postgres, money/date handling)

### 2026-07-20 — The UI is an orchestrator/courier, not a rule engine
**What I learned:** The client's job in the booking flow is to FORWARD server-owned data verbatim, not to re-derive or re-validate it: pass the rates-owned `(lane_id, rate_card_id)` pair plus breakdown/total/currency straight into booking, hardcode `actor = "user"` so privilege can't be forged, and treat the server's typed 409 as authoritative instead of pre-checking the §2.4 state machine client-side.
**How I hit it:** L4 PR-B — BookingPanel couriers the rates `QuoteResponse` into booking `POST /quotes → hold → createBooking`; BookingDetailView surfaces confirm/cancel 409 vetoes verbatim. This is the same ORCHESTRATOR role (§6.2) the agent plays in Phase 2, which is why the agent reuses the public APIs with no privileged path.
**Why it matters / where it transfers:** A UI that re-derives a price, forges an actor, or pre-enforces transitions becomes a second source of truth that can disagree with the service — keep authority server-side and the client stays a thin, honest courier the audit trail can trust.

### 2026-07-19 — Adding a REQUIRED field to a response is non-breaking; source a forwarded ID pair from one aggregate
**What I learned:** Required-field compatibility is asymmetric between request and response: adding a required property to a RESPONSE is backward-compatible (consumers only GAIN a guaranteed field), whereas adding one to a REQUEST breaks existing callers. oasdiff `breaking --fail-on ERR` vs origin/main confirmed exit 0. And when a consumer must forward a `(rate_card_id, lane_id)` pair across a service boundary, source both halves from the SAME aggregate (`card.id()` / `card.laneId()`) so the pair cannot diverge by construction.
**How I hit it:** L4 PR-A — booking-service's `POST /quotes` requires `lane_id`, but the rates `QuoteResponse` didn't expose it, so the client couldn't assemble a booking quote without inventing rates-owned data (§2.2). Fix: rates emits `lane_id` from `card.laneId()` (same aggregate as the card id it already returns) — additive and provably non-breaking.
**Why it matters / where it transfers:** Contract evolution has a request/response asymmetry worth saying out loud in a design review — an additive required RESPONSE field is safe, an additive required REQUEST field is a version bump. And a forwarded compound key is only trustworthy if its parts share one source of truth, or the two halves can drift apart later.

### 2026-07-16 — Race-safe idempotency needs three layers, not just a UNIQUE index
**What I learned:** A same-key double-submit can fail at a DIFFERENT point than the `UNIQUE(idempotency_key)` index. Under `FOR UPDATE` serialization the concurrent LOSER gets past the insert race but then hits a DOWNSTREAM consumed-state conflict (the winner already CONSUMED the quote), not a `23505`. So race-safe idempotency = fast pre-SELECT + constraint catch (`23505`) + re-check the key on the downstream state conflict too.
**How I hit it:** booking L2 — the concurrent same-key create returned 409 instead of replaying the original, because the loser tripped the quote-HELD precondition before the unique-violation path. Proven with truly-concurrent promises (`Promise.all`, no awaiting the first).
**Why it matters / where it transfers:** Concurrency bugs hide behind serialization — the loser can surface anywhere downstream of the lock, so every conflict path has to fall back to "replay the original," and you only prove it with genuinely-parallel requests.

### 2026-07-16 — Pin ORM column modes so internal types stay honest
**What I learned:** Drizzle lets you pin a column's JS mode — `bigint` cents as `mode:'bigint'`, timestamptz as `mode:'date'` (→ Date), `char(3)` currency snapshotted with no default. Pinning at the schema layer keeps the internal representation honest and pushes ISO-string / number coercion out to the boundaries only.
**How I hit it:** booking L1 schema (§4.2) — guardian pinned the modes on quotes/bookings/booking_events so `total_cents` never silently becomes a lossy JS Number and timestamps come back as Date, not strings.
**Why it matters / where it transfers:** The type you read back from the DB should match the type the column really is; leaving it to ORM defaults invites lossy Number coercion on money. Coerce at the edges, stay exact in the core.

### 2026-07-15 — "Client owns no business logic" is concrete: sort server scalars, render totals verbatim
**What I learned:** §2.2's "client owns no business logic" cashes out as three habits: sort only on server-provided scalars (never a client-computed total ranking), render server totals verbatim, and keep exactly one cents→display formatter that divides by 100 only at the render boundary.
**How I hit it:** L4 QuoteList/QuoteBreakdown/formatMoney — the sort toggles `base_rate_cents`/`transit_days_min` (labeled "Base rate", not "cheapest"), the breakdown never re-sums, and ÷100 lives in one place.
**Why it matters / where it transfers:** If the client re-derives a price or a ranking it can disagree with the service — two sources of truth for one number. Keeping money math server-side is the same discipline as not letting the UI own the state machine.

### 2026-07-15 — "Contract-first" doesn't mean the contract is valid — the lint gate does
**What I learned:** The spectral gate caught TWO latent bugs in the already-merged, hand-authored L2 spec: an unquoted comma inside a YAML flow-mapping description that parsed as a bogus null property (crashed spectral/nimma), and a 3.1-style numeric `exclusiveMinimum: 0` used inside an `openapi: 3.0.3` doc (invalid in 3.0 — the 3.0 form is `minimum: 0, exclusiveMinimum: true`).
**How I hit it:** Turning on spectral for L3 surfaced both immediately in a spec that had shipped through L2 review as "contract-first."
**Why it matters / where it transfers:** Authoring the contract before the code buys you a design, not a valid artifact — YAML footguns and OAS 3.0-vs-3.1 schema drift slip past human review. The machine gate is what makes the spec actually load-bearing.

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

### 2026-07-16 — `git diff --exit-code` only gates TRACKED files — a new generated client is toothless until committed
**What I learned:** The regen-then-diff CI pattern (`pnpm gen:api && git diff --exit-code src/api`) proves the checked-in client matches the spec — but `git diff` ignores UNTRACKED files. So a brand-new generated file passes trivially until it's `git add`-ed: CI regenerates it, finds no tracked baseline to diff against, and goes green. The generated file MUST land in the SAME commit as the script change.
**How I hit it:** booking L3 — added `booking.gen.ts` and chained it into `gen:api`; code-reviewer flagged that until the new file is tracked, the drift-check has no teeth. Fixed by staging `booking.gen.ts` as tracked so the first CI run actually compares.
**Why it matters / where it transfers:** A diff-based gate is only as strong as what git is watching — untracked = invisible = silently green. Any "regenerate and assert no diff" check must ship its baseline as a tracked file in the same commit, or the gate's first run is a no-op.

### 2026-07-16 — Design the migration path around the network topology
**What I learned:** A Postgres on an internal-only network with no host port (ADR-0001) simply cannot be migrated from the host — the migrator has to run INSIDE the network (at service boot, via `docker compose run`, or `exec`). So `make migrate-booking` runs the drizzle-orm migrator in-container; it's the TS analogue of rates' Flyway-on-startup.
**How I hit it:** booking L1 — booking-db has no published host port, so a host-run migrator can't reach it; I put the migrate step inside the compose network (`docker compose run --rm --no-deps booking-service node dist/db/migrate.js`) instead.
**Why it matters / where it transfers:** Let the network topology dictate where operational scripts run, not the other way round — if the DB is unreachable by design, every tool that touches it has to live where the DB does.

### 2026-07-15 — `git fetch origin <branch>` under actions/checkout does NOT create origin/<branch>
**What I learned:** actions/checkout configures the remote with a narrow refspec, so a bare `git fetch origin main` only updates FETCH_HEAD — it does NOT create `refs/remotes/origin/main`. A base-vs-head diff that references `origin/main` then silently compares against nothing and the gate goes green.
**How I hit it:** code-reviewer flagged it Blocking on the L3 oasdiff breaking-change job. Fixed with an explicit refspec `+refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF` plus a `git rev-parse --verify` guard so a missing base fails loud instead of skipping.
**Why it matters / where it transfers:** A CI gate that can't find its baseline should fail, not pass — a silently-empty diff is worse than no gate. Any CI step that diffs against a base ref must fetch that ref explicitly and assert it resolved.

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

### 2026-07-15 — Narrow the work, not the DoD
**What I learned:** When a layer half-depends on a service that doesn't exist yet, narrow the WORK (ship the half you can build honestly) and keep the layer's DoD/gate OPEN for the deferred half — do NOT stub a fake path. Stubbing a booking flow the client can't really call would violate contract-first (§5) and client-owns-no-business-logic (§2.2).
**How I hit it:** L4 shipped the rates-facing UI only; the booking half is deferred until booking-service + its contract exist (ADR-0004), with the L4 gate explicitly left OPEN.
**Why it matters / where it transfers:** A green DoD you reached by faking the missing dependency is a lie you'll debug later. Deferring honestly keeps the gate meaningful — better a truthfully-open gate than a falsely-closed one.

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
