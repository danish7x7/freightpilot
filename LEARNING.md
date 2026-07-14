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

## LLM Engineering (providers, tool calling, prompts)

## Evals & Testing

## Data & Domain (freight, Postgres, money/date handling)

## Ops (Docker, CI/CD, AWS, observability)

## Process (what worked / what didn't in the build workflow)

---

<!-- Example entry (delete once real ones exist):

### 2026-07-15 — Gemini vs OpenAI tool-call shapes
**What I learned:** Gemini returns function calls in a different envelope than the OpenAI schema; args arrive already-parsed vs JSON strings.
**How I hit it:** Adapter smoke test passed on Groq, failed on Gemini with the same prompt.
**Why it matters / where it transfers:** Normalizing at the adapter boundary means the agent loop stays provider-blind — same reason you normalize at repository boundaries for databases.
-->
