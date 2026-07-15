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

(entries appended here)

## TypeScript / Node / Fastify

### 2026-07-14 — Pin the build tool to your test runner's major
**What I learned:** When a test runner owns a peer of a build tool, pin the build tool to the runner's major or you get two copies in the tree with incompatible types.
**How I hit it:** client had `vite@6` as a direct devDep while vitest@2.1 + @vitejs/plugin-react pulled `vite@5`; the two Vite `Plugin` types clashed and `tsc --noEmit` failed with a deep TS2769 overload error — tests and build were fine, only typecheck broke.
**Why it matters / where it transfers:** Dual-version type clashes surface at typecheck, not runtime — so a green test run hides them. Fix was pinning client Vite to ^5.4.11 to match vitest's own Vite. General rule for any runner-owns-a-peer relationship.

## LLM Engineering (providers, tool calling, prompts)

## Evals & Testing

## Data & Domain (freight, Postgres, money/date handling)

## Ops (Docker, CI/CD, AWS, observability)

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
