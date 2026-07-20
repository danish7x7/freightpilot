# ADR-0006: Provider-agnostic LLM adapter — hand-rolled fetch, no SDKs, record/replay at the HTTP boundary

- **Status:** accepted
- **Date:** 2026-07-20
- **Phase/Layer:** Phase 2 / agent-phase L1 (global L5) — LLM adapter (§6.1)
- **Deviates from master plan:** no (§6.1 mandates the provider-agnostic layer + Gemini-primary / Groq-Cerebras fallback; this ADR records the HOW — raw fetch vs official SDKs — which the plan does not prescribe)

## Context
Agent L1 is the provider-agnostic LLM layer the L2 tool loop will sit on (§6.1): a Gemini primary with automatic fallback to Groq/Cerebras on a $0 free-tier budget. The layer must be provider-blind above the adapter seam, cheaply testable with ZERO live LLM calls in CI, and small in attack surface (it holds provider API keys and builds outbound HTTP). The architecture-guardian consult raised the choice: build on the official SDKs (`@google/genai`, `openai`) or hand-roll the HTTP against Node 22's global `fetch`. See `docs/journal/2026-07-20.md` (Session 2).

## Options considered
1. **Official SDKs per provider** — pro: less boilerplate, provider-maintained request shaping; con: two heavy dep trees + transitive attack surface, each SDK mocks differently (harder record/replay), and the SDK hides the exact HTTP bytes we want to record, normalize, and classify.
2. **Hand-rolled `fetch` adapters, record/replay at the HTTP boundary (chosen)** — pro: one normalization + one classifier over raw bytes, undici `MockAgent` mocks at the HTTP boundary so the WHOLE adapter (normalize + classify + route) runs under test, minimal deps / attack surface; con: we own request shaping and must track provider API changes ourselves.

## Decision
Build the L1 adapter as hand-rolled `fetch` providers with NO LLM SDKs, and test them via record/replay mocked at the HTTP boundary (undici `MockAgent` + `disableNetConnect`), not at the `LlmProvider` seam. Two supporting choices fall out of this: (a) ONE `OpenAiCompatProvider` class serves both Groq and Cerebras — same OpenAI-compatible wire shape, differing only by a pinned base URL + model + key — and (b) the error classifier's `RETRYABLE` set is the single source of truth driving both `LlmError.retryable` and the router's allowlist-only fallback, so classification and retry behavior cannot drift. Raw fetch keeps the HTTP boundary replayable and shrinks the attack surface, which matters more here than the SDK's convenience.

## Consequences
- Easier: zero live LLM calls in CI (`disableNetConnect`); the real router / normalizer / classifier are exercised against recorded provider bytes; smallest dep tree; base URLs pinned in a code registry (env supplies only model / key / RPM → no SSRF / host injection).
- Harder / ruled out: we own request/response shaping per provider and must follow provider API changes by hand; no SDK convenience helpers. An SDK-based adapter path is ruled out for this layer.
- Revisit if: a provider ships a materially new protocol (streaming or a new tool-call shape) that is costly to hand-maintain, or a provider drops OpenAI-compatibility such that the single `OpenAiCompatProvider` class no longer covers both Groq and Cerebras.

---
*Naming: `NNNN-short-kebab-title.md`, numbered sequentially.*
