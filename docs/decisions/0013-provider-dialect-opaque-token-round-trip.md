# ADR-0013: Provider-dialect opaque tokens must round-trip: Gemini `thoughtSignature`, and the eval-sanitize reversal it forces

- **Status:** accepted
- **Date:** 2026-08-02
- **Phase/Layer:** Phase 2 / L5 (system prompt PR), agent LLM adapter (§6.1)
- **Deviates from master plan:** no. §6.1's provider-agnostic adapter is unchanged in shape; this
  records a dialect requirement inside it.
- **Pointers:** amends the sanitize discipline recorded in
  `docs/decisions/0011-l6-eval-harness-before-l5-gate-tool-choice-and-safety.md` (Decision 2, now
  partly stale, see §5). Sits beside, and does not modify,
  `docs/decisions/0006-llm-adapter-hand-rolled-fetch-no-sdk.md`.

## Context

The L5 v1 eval capture on 2026-08-02 completed all 44 calls and froze **two non-retryable 400s**:

```
Function call is missing a thought_signature in functionCall parts.
This is required for tools to work correctly.
```

`gemini-3.1-flash-lite`, the primary as of ADR-0007 Amendment A, is a **thinking model**. It issues
an opaque `thoughtSignature` on the response part carrying a `functionCall`, and requires that token
back on the same part whenever that assistant turn is replayed into a later request. The adapter read
only `name` and `args` off an incoming `functionCall` and re-emitted only `{name, args}`, so the token
was dropped on the way in and absent on the way out.

**This is a production bug, not an eval bug.** The agent loop appends the assistant tool call to the
conversation before retrying (`agentLoop.ts`), so the failure lands on **every retry the loop makes**,
in production and in evals alike. The 400 is correctly classified non-retryable, so the router
surfaces it rather than falling back, and the turn dies. It was invisible until now because the first
call of every turn succeeds; only the second call carries an echoed tool call.

Two of 42 driven eval cases exercise a second call, and both failed:
`tools-validation-retry-zero-weight` (authored for exactly this path, hazard H5) and
`extraction-missing-destination-clarify` (which reached a second call unexpectedly, see §6).

## Options considered

1. **Round-trip the token through the adapter (chosen).** Pro: fixes the production defect at the
   seam that owns wire-format translation, needs no loop change, and costs one optional field on
   `NormalizedToolCall`. Con: forces a reversal of ADR-0011's sanitize discipline (§5), and puts an
   opaque provider blob into committed fixtures.
2. **Switch the primary to a non-thinking model.** Pro: no code change; the defect stops being
   reachable. Con: it does not fix anything, it hides a real bug behind a config choice, and it
   would be the second model swap in one session. ADR-0007 Amendment A specifically warns that model
   choice must not become a search. Rejected: the bug outlives any model we happen to pick, and
   the next thinking model reintroduces it silently.
3. **Ship with the two 400s frozen as recordings.** Pro: zero work; the capture is already on disk.
   Con: it bakes a known-broken retry path into the committed baseline, makes the one case written to
   give the retry path teeth certify the opposite, and leaves CI green at 9/10 on the tools tier
   while the shipped adapter is correct and the fixtures say otherwise. Rejected as
   dishonest-by-construction.

## Decision

**An opaque token a provider issues and requires back is part of the request contract, and the
adapter round-trips it unchanged.**

Concretely:

1. `NormalizedToolCall` carries an optional `thoughtSignature`. It is **opaque**: never logged, never
   branched on, never asserted by value. The only correctness property is that what came out of a
   response goes back into the next request unchanged.
2. `GeminiProvider` reads it off the incoming part and re-emits it **beside** `functionCall` on the
   outgoing part, not nested inside it. Position is load-bearing and is pinned by a test.
3. Providers that issue none produce a part with no such key at all, so the wire body for a
   non-thinking model is byte-identical to what it was before this field existed.
4. `sanitizeResponse` in the eval recorder **preserves** the field. See §5, where that is forced
   rather than chosen.

## Why its own ADR rather than an ADR-0006 amendment

ADR-0006 decided a **transport strategy**: hand-rolled `fetch`, no vendor SDK, with a fallback
allowlist saying which errors are retryable. Its allowlist is about *error classification*, and this
finding does not touch it. The 400 here is classified correctly already: non-retryable, no fallback,
surfaced. Nothing in ADR-0006's decision is wrong.

What this ADR decides is **request-construction fidelity** across a provider dialect, plus a reversal
of an eval-recording rule that lives in ADR-0011. That is a different subject spanning two prior
decisions, and folding it into ADR-0006 would bury a cross-cutting rule inside a document about
whether to use an SDK. A future reader looking for "why do we echo an opaque blob" would not think to
look there.

The user framing that prompted this ADR called it a **third error class**, beside ADR-0011 finding
(b) (Groq server-side-validating tool args) and ADR-0006's fallback allowlist. That is right as a
count of failure modes, and worth stating precisely because the three are easy to conflate:

| | Trigger | Where it breaks | Status |
|---|---|---|---|
| ADR-0006 allowlist | 429/5xx/timeout/network | router falls back | working as designed |
| finding (b) | Groq validates tool ARGS server-side, 400s | turn dies before the loop's Zod-retry | **OPEN**, own PR (L5-C16) |
| **this** | Gemini requires an opaque token echoed on re-send | turn dies on every retry | **FIXED here** |

Finding (b) and this one look alike from a distance: both are non-retryable 400s that kill a turn on
a tool-call path. They are not the same. Finding (b) is a provider rejecting the **model's output**;
this is a provider rejecting **our request construction**. Ours was a bug in our adapter. Finding (b)
is not, and this fix does nothing for it.

## §5 — the sanitize reversal, which is forced rather than chosen

ADR-0011 Decision 2 records that the eval recorder "persists ONLY normalized ChatResponse fields, no
secrets/auth/`thoughtSignature`," and `replayProvider.ts`'s header said the field could not leak
because it lived below normalization. **Both were true and both are now stale.** Once the field is on
`NormalizedToolCall`, recording above the wire no longer drops it for free, and the question becomes
live.

The answer is forced by the key:

> `recordingKey` hashes `req.messages`. On a retry the loop appends the assistant tool call to the
> conversation, so the signature is **inside the material the second call's key is computed from**.
> Strip it from the recording and replay rebuilds that assistant turn without it, hashes different
> bytes, and misses its own committed fixture.

A stripped fixture set could not replay a multi-turn tool conversation at all, and the failure would
be maximally confusing: the fixture is on disk, under a key nothing computes any more. So the field is
preserved, and the DoD is byte-for-byte, that a replayed retry builds the identical request a live
retry builds. Anything less reintroduces the eval-path-versus-production-path divergence that
ADR-0011 finding (a) was.

**Security assessment, reviewed and recorded rather than assumed.** The token is not a credential: no
account authority, no bearer semantics, scoped to one response, never parsed. security-reviewer
returned PASS and independently confirmed nothing logs it (all nine logger call sites in
`services/agent/src` enumerated), that it reaches no wire response, no database column, no scorecard,
and that the API key remains header-only. It also confirmed a property worth recording:
`openAiCompatProvider` does not carry the field, so a Gemini-issued token is never forwarded to Groq
or Cerebras.

Two residuals accepted here, both disclosed:

- **Secret-scanner false positives.** `scripts/record-fixtures.ts` already documented that the blob
  is high-entropy base64 that trips generic-secret rules. Roughly two of these will now sit in
  committed fixtures. The mitigation is an allowlist scoped to the **`thoughtSignature` field name**,
  never to the recordings directory, because a directory-wide allowlist is exactly what would later
  hide a real key committed there.
- **Encoded reasoning trace in a public repo.** Accepted because the eval prompts are synthetic
  freight scenarios containing no user or customer data.

## Consequences

- **Easier:** the retry path works against thinking models, in production and in replay. The pattern
  generalizes: a provider-opaque field is carried on the normalized type and round-tripped at the
  adapter seam, with the loop untouched.
- **Harder / newly true:** committed fixtures now contain provider-opaque blobs, and the recording
  set is coupled to the adapter's round-trip behavior. A future change that stops preserving the
  field breaks replay of every retry chain rather than degrading gracefully. Two tests guard it, one
  per half, each mutation-verified.
- **Known limitation, not fixed here.** A signature is valid only for the provider that issued it,
  and `NormalizedToolCall` does not record which one that was. `LlmRouter` falls back **per call**,
  not per turn, so a turn where Gemini 429s, Groq serves the tool call, and Gemini serves the retry
  echoes a signature-less part back to Gemini and produces the same 400 from the opposite direction.
  It needs a fallback and a recovery inside one turn, so it is rare, and it is out of L5's scope. The
  fix, when worth making, is to tag the issuing provider on the field and drop it when the echo goes
  elsewhere. Recorded at `types.ts` beside the field.
- **Also not fixed here:** error-envelope recordings bypass `sanitizeResponse` entirely and persist up
  to 300 characters of a provider error body verbatim. Today those bodies carry only validation
  complaints. A provider that echoed a rejected token inside an error body would land it in a fixture
  through a path with no allowlist. Noted by security-reviewer as Low; no action taken.
- **Revisit if:** the primary moves to a non-thinking model (the field goes quiet but the code stays
  correct), another provider introduces its own required-echo token, or the cross-provider limitation
  above stops being theoretical.
