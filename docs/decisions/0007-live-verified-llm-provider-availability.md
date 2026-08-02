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

---

## Amendment A — 2026-08-01: the primary moves to an EXPLICIT model id, `gemini-3.1-flash-lite`

**Status of the original decision: PARTLY REVERSED.** Dropping Cerebras stands. The Groq fallback
leg stands, unchanged. What reverses is option 3's central reasoning: the alias was chosen **for**
rotation-resilience, and rotation-resilience is now the hazard rather than the benefit. The live
chain becomes:

```
LLM_CHAIN=gemini:gemini-3.1-flash-lite,groq:llama-3.3-70b-versatile
```

### What changed the reasoning

The original con was stated correctly and understated its cost: "the served model behind the alias
can shift under us." It shifted again. During the L5 v1 eval capture on 2026-08-01,
`gemini-flash-latest` resolved to **`gemini-3.6-flash`**, a value that appears nowhere in this
repository and that nothing here requested. This is the third recorded resolution of that alias
(`gemini-3.5-flash` in the original decision, a thinking model in the consequences above, now
`gemini-3.6-flash`).

The new fact, and the one that actually forces the change: **the free-tier rate ceiling attaches to
the tier the alias resolves into, not to the alias.** The capture died at **20 requests** against
what the Flash tier allows. The dashboard's full model list shows the Lite-tier ids at **15 RPM /
500 RPD** with zero used. So the alias silently moved the project onto a tier with roughly one
twenty-fifth of the daily headroom, and the first symptom was a failed capture two thirds of the way
short.

That reframes option 2's rejection ("pinning a specific version is brittle across Google's
rotations"). Brittleness was priced as the risk of a pinned id 404ing on a rotation. The realized
risk ran the other way: an unpinned id kept working while its quota, its cost profile and its
behaviour all moved without a signal. A 404 is loud and fixable in one env edit. A silent tier
change is neither.

### The decision, and why an explicit id specifically

**`gemini-3.1-flash-lite` is chosen BECAUSE it is not rotation-resilient.** That is the property
being bought, not a cost being accepted. An explicit id cannot move underneath a multi-day capture,
so the served model is a constant the eval fixture set can be pinned against rather than a variable
the fixture set has to tolerate.

Live-verified before the switch, two calls, 2026-08-01:

| | `gemini-3.1-flash-lite` | `gemini-3.5-flash-lite` |
|---|---|---|
| Serves this key | yes | yes |
| Full six-tool function declarations | accepted, no 400 | accepted, no 400 |
| Result | correct `search_rates` call, all four args right | identical |
| `servedModel` | `gemini-3.1-flash-lite` | `gemini-3.5-flash-lite` |

Both echo the requested id, so neither carries an alias layer. The probes drove the real
`GeminiProvider` with the real `TOOLS` set and the real production prompt, deliberately: ADR-0011
finding (a) was a **tool-schema rejection**, and a bare completion probe would have passed while a
full-TOOLS turn 400'd. Note what this does and does not show. `exclusiveMinimum` was already removed
from `shipmentJsonSchema` in PR #21, so the probe confirms **the current schema is accepted by both
Lite models**. It is not evidence that a previously-rejected keyword now works.

3.1 over 3.5 on one argument only: a lower version number is less likely to be repointed or retired
first. Nothing in the evidence separates them, and 3.5-flash-lite is the standby if 3.1 is withdrawn.

### SEQUENCE, recorded while it is still unambiguous

**The model was chosen on 2026-08-01, on quota grounds, before any v1 extraction score existed.** No
scorecard has been produced at `prompt_version: v1`. The pre-registered extraction floor
(ADR-0012 §2.4, committed at `367ea06`) predates both this switch and any run against it.

This sequence is load-bearing and cannot be reconstructed from the diff later, which is why it is
written here rather than inferred:

**A model choice revisited AFTER seeing a score would be reverse-engineering the floor by search
over models.** Trying backing models until one clears 0.79 produces a number that looks earned and
was selected for, which is ADR-0011 finding (a)'s defect class (a label decoupled from what actually
happened) in a new costume, and worse than a missed floor because it leaves no trace in the artifact
record.

ADR-0012 §2.6 fixes exactly two permitted responses to a v1 miss: re-cut the prompt and re-capture,
or ship extraction non-gating with the reason recorded. **A model swap is not among them and must
not be added.** If `gemini-3.1-flash-lite` misses the floor, that is a real finding about the
shipped configuration, and the honest landing is extraction shipping non-gating with the observed
rate recorded.

### Consequences

- **Easier:** 500 RPD against a 43-call capture is roughly 11x headroom, so the capture is a single
  pass rather than a multi-day resume. The served model is pinned, so the fixture set has one
  provenance value by construction.
- **Cost paid immediately:** the 20 fixtures captured under `gemini-3.6-flash` were **deleted**.
  `recordingKey` hashes `prompt_version`, `messages` and the tool contract only, so the model is
  **not** in the key and those fixtures would have been silently reused on a resume, producing a set
  that was part `gemini-3.6-flash` and part `gemini-3.1-flash-lite`. That is the mixed-provenance
  set `evals/runner/test/recordingProvenance.test.ts` now rejects. `PROMPT_VERSION` is unaffected
  and the L5-C8 step 4 prompt freeze is untouched.
- **Harder / ruled out:** the alias no longer absorbs Google's rotations. When `gemini-3.1-flash-lite`
  is retired this chain 404s and needs a deliberate re-pin, a re-record, and an amendment. That is
  the trade being made: a loud failure that forces a decision, over a silent one that moves the
  ground under a committed baseline.
- **Unchanged:** the Groq fallback leg. It is structurally unreachable during a capture (record mode
  builds a single-entry router from `chain[0]`), and the one thing known to be wrong on it is
  ADR-0011 finding (b), which L5-C16 removes from L5's scope and requires ship as its own PR. Moving
  it here would either mask that finding or look like it.
- **Revisit if:** `gemini-3.1-flash-lite` is retired or repointed, the Lite tier's published limits
  change, or a funded account removes the free-tier constraint that drove this entirely.
