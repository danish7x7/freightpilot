# ADR-0007: Live-verified LLM provider availability — Cerebras dropped, Gemini pinned to an alias

- **Status:** accepted
- **Date:** 2026-07-20
- **Phase/Layer:** Phase 2 / agent-phase L1 (global L5) — LLM adapter (§6.1)
- **Deviates from master plan:** yes (§6.1) — the plan's committed provider defaults (`gemini-2.5-flash` primary; Groq + Cerebras fallback) did NOT survive live verification against newly-issued API keys. This ADR pins what the live chain actually is; the provider-agnostic layer + $0 free-tier target from §6.1 are unchanged.

> Backfill note: this ADR is recorded after the fact to close a dead link — the merged commit `acfca7d` references "(ADR-0007)" but no `0007-*.md` file was committed at the time (see the numbering note in ADR-0008). It RECORDS an already-settled, already-live decision; it makes no new choice. ADR-0008 correctly kept 0008 to avoid reusing a bound number; both now exist.

## Context
Agent L1's `LLM_CHAIN` (ADR-0006) is config-driven `provider:model` pairs, and MASTER_PLAN §6.1 committed the defaults as a `gemini-2.5-flash` primary with Groq + Cerebras fallback on a $0 free-tier budget. When the chain was live-verified against freshly-issued API keys (the re-record pass, `docs/journal/2026-07-20.md` Session 3, and the earlier build in Session 2), those committed defaults did not hold: the primary model 404'd for new keys and one fallback provider was paywalled. The chain needed to be pinned to what the providers actually serve today, not to the plan's aspirational defaults.

## Options considered
1. **Keep the plan's committed defaults (`gemini-2.5-flash`; Groq + Cerebras fallback)** — pro: matches §6.1 verbatim, no deviation to document; con: does not run — `gemini-2.5-flash` returns 404 for new keys and Cerebras returns 402 for every model, so the chain is dead on a fresh account. Rejected against live evidence.
2. **Pin an exact new Gemini version + keep Cerebras** — pro: deterministic model id; con: pinning a specific version is brittle across Google's rotations, and Cerebras is unusable on the free tier regardless. Rejected.
3. **Pin Gemini to a rotation-resilient ALIAS and drop Cerebras from the live chain (chosen)** — pro: the alias survives Google version rotation, the chain runs at $0; con: the served model behind the alias can shift under us (e.g. to a thinking model), and one fewer live fallback slot.

## Decision
The live chain is **`gemini:gemini-flash-latest,groq:llama-3.3-70b-versatile`** — Gemini primary, Groq fallback, within the $0 free-tier target. Two live-verified findings force this:
- **`gemini-2.5-flash` returns 404 for NEW API keys** ("no longer available to new users"). The chain uses **`gemini-flash-latest`, an ALIAS** (resolved live to `gemini-3.5-flash`), chosen for rotation-resilience over pinning a specific version — we accept the served model shifting under the alias rather than re-pinning on every Google rotation.
- **Cerebras is DROPPED from the live chain:** its free tier returns **402 Payment Required for ALL models** on a new account (tested `gpt-oss-120b`, `gemma-4-31b`). The `OpenAiCompatProvider` class AND the hand-authored Cerebras fixtures **STAY** — they prove one class serves multiple OpenAI-compatible base URLs (ADR-0006) — but there is **no live Cerebras slot** in the chain.

Deciding rationale: the chain is config-driven, so "which providers are live" is an env fact that must reflect reality; a committed default that 404s/402s on a fresh key is worse than an honestly-recorded deviation.

## Consequences
- **Easier:** the chain runs at $0 on freshly-issued keys with no code changes; the alias absorbs Google's version rotations without a re-pin; re-adding Cerebras (or any OpenAI-compatible provider) if the account is ever funded is an **env change, not a code change** — the class and fixtures already exist.
- **Harder / ruled out:** one fewer live fallback provider (Gemini→Groq only); the served model behind `gemini-flash-latest` is not pinned, so it can change under us — which it already did (the alias now resolves to a THINKING model).
- **Open follow-up (DEFERRED to L4, NOT resolved here):** the alias now serves a thinking model, so responses carry `usageMetadata.thoughtsTokenCount`, but the adapter maps `outputTokens = candidatesTokenCount` only (`src/llm/geminiProvider.ts`) — thinking tokens, which providers bill as output, are currently EXCLUDED from usage telemetry. Whether `outputTokens` should include `thoughtsTokenCount` is a cost-telemetry question carried to the L4 telemetry work.
- **Revisit if:** Google retires or repoints the `gemini-flash-latest` alias, Groq changes free-tier availability, or the Cerebras (or another) account is funded and a fallback slot is re-added via env.

---
*Naming: `NNNN-short-kebab-title.md`, numbered sequentially.*
