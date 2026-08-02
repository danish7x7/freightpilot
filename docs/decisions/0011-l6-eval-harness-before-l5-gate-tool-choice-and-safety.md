# ADR-0011: L6 eval harness lands BEFORE the L5 prompt — drive the real agent path over recorded responses; gate tool-choice + safety now, defer extraction gating to the L5 prompt PR

- **Status:** accepted — **AMENDED 2026-07-28 (see "Amendment A" at the bottom; the decision stands, several recorded FACTS below are now stale and are marked inline)**
- **Date:** 2026-07-23 (amended 2026-07-28)
- **Phase/Layer:** Phase 2 / L6 (eval harness) — MASTER_PLAN §7 (eval suite + gating) / §L5-adjacent
- **Deviates from master plan:** yes — **phase order** (L6 evals land before L5, the system prompt) AND **partial DoD** (§7 threshold gating is only partially closed now; extraction gating + the 85% ratchet + the break-the-prompt proof defer to the L5 prompt PR). Both deviations are the substance of this ADR.

## Context
"Prompt files are code" (CLAUDE.md / §5) requires that any change to a `prompts/*.md` file **run the eval suite** and clear a **CI-gating** pass rate before merge. That is impossible if the suite does not exist: you cannot regression-gate the L5 system prompt PR on `make evals` until `make evals` EXISTS and gates. So the eval harness (L6) must precede the prompt (L5) — the reverse of the nominal layer order. This session builds that harness. The architecture-guardian pre-approved a **DoD-honest cut** with five conditions (C1–C5), the headline of which (C1) is that the L6-before-L5 phase-order deviation must be recorded in an ADR that lands **in the same PR** as the code — this document. Triggered by `docs/build-prompts/L6-eval-harness.md` and the D14 journal's carried "L5 prompt PR" note (`docs/journal/2026-07-22.md`).

## Options considered
1. **Build L5's prompt first, then L6's evals.** Pro: matches the nominal layer numbering. Con: the prompt PR could not be gated on an eval suite that doesn't exist — it would violate "prompts are code" (a prompt change with no eval run), which is the exact regression discipline the whole scheme exists to enforce. Rejected: it inverts the dependency.
2. **Build the FULL L6 now — extraction gating at 85%, the upward ratchet, and the break-the-prompt DoD proof.** Pro: closes the L6 DoD in one PR. Con: there is **no prompt to break yet**, so the break-the-prompt proof has no subject; and a promptless (`v0-none`) extraction pass rate cannot honestly justify an 85% gate — you'd be standing up a bar the current code can't clear or lowering it to fit. Rejected as dishonest-by-construction.
3. **Ship the harness now — the gate MECHANISM plus gating on tool-choice + safety — with extraction as a non-gating `v0-none` baseline; carry extraction gating + ratchet + break-the-prompt proof into the L5 prompt PR (chosen).** Pro: `make evals` exists and gates before the prompt PR needs it; the two tiers that CAN be honestly gated promptless are gated now; the deferred tiers travel with the prompt they actually measure. Con: L6's DoD closes only partially in this PR — accepted, and recorded here + in the journal.

## Decision
Land the L6 eval harness before the L5 prompt, gating tool-choice + safety now, with extraction a non-gating `v0-none` baseline; the harness drives the **real production code path** over **recorded** LLM responses and makes **zero production-code changes**.

1. **The runner drives real agent SOURCE, not a reimplementation (C5).** `evals/runner` imports `runAgentTurn`, `TOOLS`, the `LlmProvider`/`LlmRouter` seam, and `runTurn` from agent-service via a single barrel (`evals/runner/src/agent.ts`). It does NOT redefine the loop, the tools, or the Zod validators — those are the things under test. Stub `ToolClients` replace ONLY the network+persistence edge (C2) and echo received args into `ToolResult.data`; the loop, the validate path, and the proposal seam are never stubbed.
2. **Determinism via `ReplayProvider` (an `LlmProvider`).** In CI it serves committed recordings with **zero API calls**; a replay **miss is a hard `ReplayMissError` that aborts non-zero** (never a silent live call, never a soft skip — code-reviewer Blocking, see Consequences). Record mode (`EVAL_RECORD=1`, manual, never in CI) wraps the real provider inside the real router and persists ONLY normalized `ChatResponse` fields — no secrets/auth/`thoughtSignature` (mirrors the L1 `record-fixtures.ts` sanitize discipline). Scorecards are byte-deterministic: no timestamps/latency/tokens in the committed body (`evals/results/2026-07-24_v0-none.json`).
3. **§7 threshold decisions (recorded here, not left implicit in CI).**
   - **Safety gates at 100%** — a single gated-action failure blocks merge; there is no partial credit on safety. Observed: **6/6**.
   - **Tool-choice GATES now at an absolute floor of 0.8.** The floor is an **independent standard** — a competent tool selector should pick the right tool on ≥80% of unambiguous cases (tolerating 1 of 9) — **not** reverse-engineered to the observed rate. The observed promptless `v0-none` tool-choice pass rate is **1.0 (9/9)**, which clears a meaningful bar, so tool-choice did NOT partially defer. (The one air-vs-ocean two-call case is an explicit xfail/pending, not counted: `runAgentTurn` returns only the first tool call — `agentLoop.ts:66`.) **[Amendment A, 2026-07-28: the 1.0 tools rate is UNCHANGED after re-recording against the primary provider — see A3. The 0.8 floor was therefore never set against fallback-derived evidence.]**
   - **Extraction is a non-gating `v0-none` baseline: 10/15.** **[STALE — Amendment A, 2026-07-28: now 14/15 (0.9333) after the fixture set was re-recorded against the PRIMARY provider. This is RE-MEASUREMENT, not a capability change — see A3.]** Extraction gating, the **85% upward ratchet**, and the **break-the-prompt DoD proof** carry into the L5 prompt PR (there is no prompt to break yet; the runner's gate-mechanism unit test — a corrupted recording drops a gating tier below threshold → non-zero exit — is the L6-now stand-in). **[Amendment A: that stand-in test was NOT RUN BY CI until 2026-07-28 — see A4.]**
4. **`prompt_version` sentinel `v0-none` is the single source of truth (C5)** — one const (`src/promptVersion.ts`), stamped into the scorecard; the L5 prompt PR bumps it, invalidating every throwaway `v0-none` recording.
5. **One safety case asserts through `runTurn` (C4)** — where the token is minted — proving a proposal does not auto-execute at the turn boundary (a minted-but-unredeemed token is the correct safe outcome; a booking side-effect is a FAIL). C1–C5 all verified (C1 = this ADR; C3 = the partial-DoD note above).

## Consequences
- **Easier:** the L5 prompt PR can now be gated like code — `make evals` exists, replays committed recordings with zero API calls / no secrets, and exits non-zero when tool-choice or safety regress; `git diff` on the scorecard shows real capability change, not noise. The gate mechanism is itself tested (corrupted-recording → non-zero exit), so "the gate gates" is proven now, before there's a prompt to gate.
- **Two latent PRODUCTION provider findings surfaced by driving the real path — flagged for L5/debugger, NOT fixed here (the harness makes zero production changes):**
  - **(a) Gemini — the PRIMARY provider — rejects the tool SCHEMA.** `shipmentJsonSchema` uses `exclusiveMinimum`, which Gemini's function-declaration dialect does not accept → **400, non-retryable → no fallback**. So any real turn using the full `TOOLS` set against Gemini-primary would 400. D14's tests never caught this because they mock HTTP (a mock fakes the 200; it never lets the provider reject your request). **[RESOLVED 2026-07-28 — Amendment A (A1/A2). "NOT fixed here" no longer describes the state of the repo.]**
  - **(b) Groq server-side-validates tool calls** and 400s `tool_use_failed` on schema-invalid promptless args, crashing the turn **before** the loop's Zod-retry can engage. Consequence: the `v0-none` recordings were captured from the Groq **FALLBACK** provider, and the 3 extraction error-cases are these real 400s replayed as FAILs (part of why extraction sits at 10/15 promptless). **[Finding (b) itself remains OPEN, deferred to L5. But the FALLBACK-PROVENANCE claim in this bullet is STALE as of 2026-07-28: the committed fixture set is now 100% PRIMARY-served and a test enforces that — see A2.]**
- **Harder / ruled out:** `evals/runner` is a **STANDALONE package** (its own pnpm v9 lockfile) that imports agent SOURCE by **relative path**, NOT a root pnpm workspace — because no workspace exists and creating one would change install behavior for every existing service (high blast radius). Trade-off: `make evals` and CI must `pnpm install` services/agent FIRST so the runner can resolve agent's transitive deps. The `v0-none` recordings are throwaway — the L5 prompt changes `messages`, invalidating every replay key; the recordings dir carries a README saying so.
- **Revisit when:** the **L5 prompt PR** lands — it bumps `prompt_version` off `v0-none`, re-records fixtures, adds extraction-tier gating + the 85% ratchet + the break-the-prompt proof, and closes the remaining L6 DoD. Fix the two provider findings there (or via debugger): drop `exclusiveMinimum` from `shipmentJsonSchema` (or translate it for Gemini's dialect) so the PRIMARY provider accepts the tool schema, and make promptless/invalid tool args survive Groq's server-side validation into the loop's Zod-retry. The optional 5-case live Groq smoke stays non-gating (nondeterministic) and folds in with L5 if not before. **[PARTIALLY DISCHARGED EARLY, 2026-07-28: finding (a) did not wait for L5 — it was fixed in its own PR, ahead of the prompt, because the whole `v0-none` baseline was fallback-derived and therefore not a trustworthy starting point for L5. Finding (b) and everything else in this clause still travel with the L5 prompt PR.]**

---

## Amendment A — 2026-07-28: finding (a) is FIXED; the baseline is re-recorded, corrected, and ALIAS-BOUND

**Status of the decision itself: UNCHANGED.** The L6-before-L5 phase order, the partial DoD, the standalone-package choice, and the safety=100% / tools≥0.8 thresholds all stand. This amendment corrects FACTS recorded above that went stale, and adds one new constraint (A5) that eval-auditor asked to be recorded here rather than only in the journal. Written against the 2026-07-28 session (`docs/journal/2026-07-28.md`); review chain: code-reviewer APPROVE WITH NITS, security-reviewer PASS, eval-auditor SOUND.

**Why an amendment and not ADR-0012.** This ADR's own "Revisit when" clause scoped the fix and even named both candidate remedies ("drop `exclusiveMinimum` … or translate it for Gemini's dialect"), so no new architectural choice was opened — the fix chose between alternatives this ADR had already framed. And correcting the stale numbers only in a separate document would have left this one actively misleading (10/15, "captured from the Groq FALLBACK", "(a) NOT fixed here"), with finding (a)'s story split across two files. One record, corrected in place.

### A1 — The fix, and what was chosen over what
`exclusiveMinimum: 0` → **`minimum: 0`** on `weight_kg` and `volume_cbm` in `shipmentJsonSchema`, with the strict ">0" intent moved into each field's **`description`** (the text the model actually reads). Rejected alternative: **per-provider schema translation in the adapter** — it buys dialect fidelity at the cost of a provider-specific transform layer, for a constraint the model-facing schema does not need to enforce in the first place.
- **Zod `cargoSchema` keeps `.gt(0)` and is UNCHANGED. It remains the enforcement boundary** — the loop refuses to execute a tool whose args fail `validate`, so the value the hint now admits (`0`) is still rejected before anything happens.
- The consequence is deliberate and load-bearing: **the model-facing hint is now WEAKER than the rule.** `test/tools/cargoBounds.test.ts` pins that asymmetry so the obvious "the two disagree, align them" cleanup — dropping Zod to `min(0)` — cannot land with a green suite.
- Mechanism, stated falsifiably: Gemini's function-declaration `Schema` proto is an **OpenAPI-3.0 SUBSET**, so an **unknown FIELD NAME is a deterministic JSON→proto parse rejection → non-retryable 400 → no fallback** (the fallback allowlist is 429/5xx/timeout/network only, ADR-0006). `test/tools/geminiSchemaCompat.test.ts` walks the same object graph the provider serializes and fails the build on any keyword outside Gemini's allowlist.

### A2 — The committed baseline is now PRIMARY-served, and a test enforces it
All 30 fixtures were **re-recorded against Gemini-primary**; `evals/results/2026-07-28_v0-none.json` supersedes the 07-24 scorecard. `prompt_version` stays `v0-none` (L5 bumps it). `evals/runner/test/recordingProvenance.test.ts` fails if any committed recording names a provider other than the declared primary, if the set is mixed-provenance, or if a non-error recording carries no model label — error envelopes explicitly included, since a recorded Groq error is precisely how a fallback-served fixture would re-enter the set. It hardcodes the expectation rather than reading `LLM_CHAIN`, because an env-derived expectation would follow a mis-pointed capture into a green run. Record mode also gained inter-case pacing (`EVAL_RECORD_DELAY_MS`) so a capture cannot 429 itself onto the fallback.
**The generalizable point:** finding (a)'s real defect was not the keyword — it was that a **non-retryable primary rejection was INVISIBLE**, because the recording key excludes `provider` (deliberately, §Decision 2) and nothing ever inspected the bytes. A green suite says nothing about WHICH provider served it unless provenance is asserted.

### A3 — Extraction 10/15 → 14/15 (0.667 → 0.9333): re-measurement, not capability
No agent code path got better at extraction; the loop, tools, and validators are behaviorally unchanged, and **zero files under `evals/cases/` were touched**. eval-auditor verified case-by-case that this is **FOUR flips, not three**:
- **3** were Groq `tool_use_failed` 400s (finding (b)) replayed as failures — corrected measurement.
- **1** — `extraction-missing-destination-clarify` — is a genuine **primary-vs-fallback BEHAVIOR difference**: Groq acted, Gemini clarified.
State it as **"3 corrected 400s + 1 provider behavior difference,"** not "purely corrected measurement."
**Gaming was positively excluded, not asserted:** the auditor reconstructed the pre-diff schema, recomputed all 31 recording keys under both the old and the new schema, and confirmed every old key maps to a deleted file and every new key to an added one — the fixture churn is **structurally forced** by the key hashing over tool schemas.
**Preserved from the original decision:** the **tools tier scored 1.0 both before and after**, so the 0.8 floor was **not** set against fallback-derived evidence.

### A4 — The gate-mechanism stand-in was not actually gating
§Decision 3 cites the runner's gate-mechanism test as the L6-now stand-in for the deferred break-the-prompt proof. eval-auditor found that **`evals/runner/test/**` was never run by CI** — the `evals` job ran only `make evals`, and the unit matrix is `[booking, agent]`. So `gate.test.ts`, `toolClassification.test.ts`, and the new provenance guard were all decorative. CI now runs `cd evals/runner && pnpm test`. Without this, the guard added in A2 could not have blocked a merge.

### A5 — NEW CONSTRAINT: the extraction baseline is ALIAS-BOUND — re-RECORD, don't re-run
The 4th flip in A3 proves that a meaningful slice of the extraction baseline is **provider-sensitive**: **0.9333 is a *Gemini* number, not a property of the agent loop.** ADR-0007 pins the chain to **`gemini-flash-latest` — an ALIAS whose backing model shifts** (it already has once, to a thinking model). So a silent alias rotation can move the baseline with **no line changing in this repo**.
**Therefore: if the primary provider changes, or the model behind the alias changes, the baseline must be RE-RECORDED, not merely re-run.** A replayed suite would keep reporting the old provider's numbers for a chain that no longer serves them. This is the durable lesson of finding (a) — stronger than "the fixtures are Gemini" — and it applies to the L5 ratchet too: an 85% floor set against alias-bound evidence inherits the alias's volatility.

### A6 — Still open after this amendment
- **Finding (b) remains OPEN, deferred to L5:** Groq server-side-validates tool calls and 400s `tool_use_failed` before the loop's Zod-retry engages.
- **Extraction gating, the 85% ratchet, and the break-the-prompt proof remain deferred** — and gating now carries a hard precondition recorded in `docs/journal/2026-07-28.md`: `scoreText` currently passes on an EMPTY response, and the current 15-case mix hands 12 of 15 cases explicit UN/LOCODEs with every §7 hard class absent (hard-case ratio 3/15). Fix the scorer, add hard cases, re-baseline, THEN set the floor.
- **ADR-0007 backfill (partially closed here):** the live-verified chain was propagated into `.env.example`, `docker-compose.yml`, `services/agent/.env.example` and `config.ts`; `CLAUDE.md` still says "primary Gemini 2.5 Flash". This mattered — a reviewer read those stale copies as authoritative over ADR-0007 and prescribed re-recording against `gemini-2.5-flash`, which 404s for new keys and would have driven capture straight back onto the fallback, re-creating finding (a) under the banner of fixing it.

---
*Naming: `NNNN-short-kebab-title.md`, numbered sequentially.*

---

## Amendment B — 2026-08-02: Decision 2's sanitize clause is superseded for `thoughtSignature`

**Status of the decision itself: UNCHANGED.** One clause of one bullet is now stale and is corrected
here so the governing document does not contradict the code.

Decision 2 above reads that record mode "persists ONLY normalized `ChatResponse` fields — no
secrets/auth/`thoughtSignature`." The `thoughtSignature` half no longer holds. As of **ADR-0013**
the eval recorder **preserves** that field, and it is forced rather than chosen: the token is inside
the key material `recordingKey` computes for the next call in a retry chain, so a stripped fixture
set cannot replay a multi-turn tool conversation at all.

The secrets/auth half stands unchanged and is unaffected. The recording seam is still above the wire,
so no auth header or API key can reach a fixture, and security-reviewer re-verified that on
2026-08-02.

See `docs/decisions/0013-provider-dialect-opaque-token-round-trip.md` for the reasoning, the security
assessment, and the two residuals accepted.
