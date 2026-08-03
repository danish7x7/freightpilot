# L5 architecture-guardian conditions and hazards — verbatim record

**This is a RECORD, not a build prompt.** It exists so the exact text of every L5 guardian
condition survives independently of the session that produced it. A build prompt already exists;
do not treat this file as one.

Two guardian consults produced this material:

- **Consult 1 — "L5 system prompt (design pre-check)"** (2026-07-28). Rulings 1–5, conditions
  **C1–C18**, hazards **H1–H6**. Predates the PR split, so it allocates nothing to PR A or PR B.
- **Consult 2 — "L5 PR shape (follow-up)"** (2026-07-28). Ruled the two-PR split (ORIGINAL SPLIT;
  single-PR and variant split both rejected). Amended **C1, C9, C11**, replaced **C2** with
  **C2a/C2b**, superseded **C15(iii)** with **C19**, added **C20** and **C21**, added hazard **H7**.

Where a condition was amended or replaced, **both texts appear in full** below — the original
marked SUPERSEDED, the replacement marked GOVERNING. Neither is collapsed into the other.

Allocation is taken from the consult text and from PR A's review record. PR A conditions are
marked DISCHARGED with the artifact that discharges them, so a later reader cannot carry finished
work forward as outstanding.

---

## NUMBERING COLLISIONS — read before citing a bare "Cn"

The L6 guardian consult issued **C1–C5** and L5 consult 1 issued **C1–C18**. Every number in
**C1–C5 collides across the two layers**, and both schemes are cited in live code — in two cases
within the same file. A bare `Cn` for n ≤ 5 is ambiguous and must be qualified `L5-Cn` / `L6-Cn`.

| # | L6 meaning (by citation site) | L5 meaning (this record) | Both cited in code? |
|---|---|---|---|
| C1 | ADR-0011 must land in the same PR as the code | One message composer, both call sites | L5 only, widely |
| C2 | Stubs replace the network/persistence edge only | *(replaced by C2a/C2b)* | **Yes** — L6 in `stubClients.ts:4`; L5-C2a in `score.ts:263`, `systemPrompt.ts:16` |
| C3 | Partial-DoD recorded (extraction gating defers) | `PROMPT_VERSION` ownership → agent-service | **Yes** — L6 in `gating.ts:10`, `gate.test.ts:10`; L5 in `promptVersion.ts:2`, `agent.ts:20`, `systemPrompt.ts:37` |
| C4 | One safety case asserts through `runTurn` (`assert_through_turn`) | Version identifier derived from / checked against the prompt filename | **Yes** — L6 in `caseSchema.ts:82`, `score.ts:20,174,191,274`; L5 in `systemPrompt.test.ts:63` |
| C5 | `TOOLS` imported + args echoed + `v0-none` sentinel | The prompt is a file under `prompts/` | L6 only (`stubClients.ts:4,9,47`); L5-C5 is PR B and not yet cited |

**Files citing both schemes simultaneously:** `evals/runner/src/caseSchema.ts` (L5-C1 at :17, L6-C4
at :82) and `evals/runner/src/score.ts` (L6-C4 at :20/:174/:191/:274, L5-C1 at :259, L5-C2a at :263).

**The L6 consult's condition texts are NOT RECOVERABLE from the source session.** The L6 column
above is derived from the citation sites in code, read directly — not from the L6 consult text,
which is not present in the session that produced this record. The journal's one-line glosses of
L6-C1…C5 were deliberately not used. Anyone needing L6's verbatim conditions must recover them
from the L6 consult itself.

---

# CONDITIONS

## C1 — one composer, both call sites

**Consult 1 — SUPERSEDED by the consult 2 amendment below.**

> **C1.** Prompt composition must live in **one exported function in agent-service** (e.g. `services/agent/src/prompt/systemPrompt.ts`), called by `runTurn` in `/home/danish07/projects/freightpilot/services/agent/src/turn/turnService.ts` (replacing the hardcoded `messages` array at line 57) **and** by the eval runner's `toMessages()` in `/home/danish07/projects/freightpilot/evals/runner/src/score.ts:230`, re-exported through the barrel `/home/danish07/projects/freightpilot/evals/runner/src/agent.ts`. Two composition sites is not acceptable.

**Consult 2 — GOVERNING.**

> **C1 (amended, both PRs).** As originally written, plus: verification is by reading the actual call graph from both entry points to the composer, **in addition to** C2a/C2b's automated tests, never instead of them. This verification is repeated in PR B against PR B's version of the composer; C1's guarantee is not inherited from PR A.

**Allocation:** both PRs (consult 2 states this explicitly).
**PR A half — DISCHARGED.** Artifact: `services/agent/src/prompt/systemPrompt.ts` (`composeMessages`),
called from `services/agent/src/turn/turnService.ts:57` and `evals/runner/src/score.ts` `toMessages`,
re-exported via `evals/runner/src/agent.ts`. Call graph read and confirmed in code-reviewer's PR A
review. **PR B half — OUTSTANDING:** re-verify against PR B's composer.

---

## C2 → C2a / C2b — the driven-request assertion

**Consult 1 — SUPERSEDED. Replaced by C2a and C2b.**

> **C2.** A test must assert that the request actually driven for a scored eval case **contains the system prompt message**. Without it, 30 of 31 cases can replay a promptless path stamped `v1`.

**Consult 2 — GOVERNING (PR A half).**

> **C2a (PR A).** The message composer is a pure function taking the system prompt as a parameter. PR A must include: (i) a unit test asserting that, given a non-empty sentinel prompt, the composer's output contains it as a `role: "system"` message; and (ii) tests asserting that the request driven by `runTurn` (`/home/danish07/projects/freightpilot/services/agent/src/turn/turnService.ts`) **and** the request driven by the eval runner (`/home/danish07/projects/freightpilot/evals/runner/src/score.ts:230`) both equal the composer's output for the same input. No test-only override may allow the eval path to supply a different prompt than production. PR A's description must state precisely what remains unproven: that the production prompt value is threaded into the composer at both call sites, which is unprovable until a prompt exists and lands as C2b.

**Consult 2 — GOVERNING (PR B half).**

> **C2b (PR B).** With the prompt authored, extend C2a(ii) to assert that both driven requests contain the **production** prompt text, sourced from the single production constant. PR B's DoD is not met until C2b passes.

**Allocation:** C2a → PR A; C2b → PR B.
**C2a — DISCHARGED.** Artifacts: `services/agent/test/prompt/systemPrompt.test.ts`,
`evals/runner/test/composerSeam.test.ts`, and — after eval-auditor's Blocking B1 found the plain
equality assertions tautological at `v0-none` — `services/agent/test/prompt/promptReachesTurn.test.ts`
and `evals/runner/test/composerSeamMocked.test.ts`, which mock `SYSTEM_PROMPT` to a sentinel while
keeping the real composer, making the assertion falsifiable before a prompt exists. Verified by
mutation: reverting both call sites produces 1 failure in agent-service and 3 in the runner.
**C2b — OUTSTANDING.**

---

## C3 — `PROMPT_VERSION` ownership

**Consult 1. Not amended.**

> **C3.** `PROMPT_VERSION` moves to **agent-service** as its single source of truth (it must be logged on every LLM request per §6.3.5). `/home/danish07/projects/freightpilot/evals/runner/src/promptVersion.ts` re-exports it through the barrel; it must not hold its own literal. Two constants means the scorecard can label `v1` while the service ships `v2`.

**Allocation:** PR A. **DISCHARGED.** Artifacts: `PROMPT_VERSION` defined in
`services/agent/src/prompt/systemPrompt.ts`; `evals/runner/src/promptVersion.ts` reduced to a bare
re-export. code-reviewer confirmed exactly one literal exists repo-wide.

---

## C4 — version identifier tied to the prompt filename

**Consult 1. Not amended.**

> **C4.** The version identifier must be **derived from or checked against the prompt filename** (`prompts/v1_system.md` ↔ `v1`), enforced by a test. A prompt file swapped without a version bump must fail CI, not silently re-key the fixtures.

**Allocation:** PR B. OUTSTANDING.

---

## C5 — the prompt is a file

**Consult 1. Not amended.**

> **C5.** The prompt is a **file under `/home/danish07/projects/freightpilot/prompts/`** (hard rule 6). A TypeScript string literal is a violation. If the text is embedded via a generated module, the `.md` remains the source of truth and CI enforces drift with a `git diff --exit-code` check, mirroring the existing `gen:api` pattern.

**Allocation:** PR B. OUTSTANDING.

---

## C6 — fail-fast on a missing prompt

**Consult 1. Not amended.**

> **C6.** A missing/unreadable prompt file must be a **fail-fast boot error** in agent-service. A silent fall-through to promptless is finding (a)'s exact failure shape: production running one path while the evals certify another.

**Allocation:** PR B. OUTSTANDING.

---

## C7 — packaging

**Consult 1. Not amended.**

> **C7.** **Packaging must be solved and proven in the same PR.** `docker-compose.yml` builds agent-service with context `./services/agent`, and `/home/danish07/projects/freightpilot/services/agent/Dockerfile` copies only `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `src`, and `drizzle` — **repo-root `prompts/` is not in the build context and cannot be read at runtime.** Resolve by moving the build context to the repo root with an explicit `dockerfile:` path plus `COPY prompts ./prompts`, or by generating the prompt module at build time from the `.md` (see C5) so nothing is read from disk at runtime. Verify by booting the container, not by reading the Dockerfile.

**Allocation:** PR B. OUTSTANDING.

---

## C8 — capture ordering

**Consult 1. Not amended.**

> **C8.** Capture ordering is fixed as ruling 3, steps 1–7. Nothing that alters `messages`, `tools`, or `prompt_version` lands after step 6.

The steps 1–7 C8 binds to, verbatim from consult 1 ruling 3:

> Ordering (this is C8's content, stated once here):
> 1. `scoreText` + case-schema fix.
> 2. All six new hard cases + the heavy-but-valid counter-case, with expectations pre-registered.
> 3. Prompt authored; production composition seam wired (ruling below / C1); `PROMPT_VERSION` ownership moved (C3); packaging solved and proven (C6/C7).
> 4. Prompt iterated against the scratch probe set. **Freeze.**
> 5. Pre-register the extraction floor in writing.
> 6. **One** full capture into the committed recordings dir, defaults pacing (`EVAL_RECORD_RPM=12`, `EVAL_RECORD_DELAY_MS=5000`).
> 7. Score, apply the pre-registered floor, commit the scorecard.

**Allocation:** PR B, with step 1 and parts of step 3 (C1, C3) already discharged by PR A —
consult 2 ruled that step 3 need not land atomically. OUTSTANDING for steps 2, 4–7.

---

## C9 — fixture completeness / all-or-nothing recordings

**Consult 1 — SUPERSEDED by the consult 2 amendment below.**

> **C9.** The recordings directory is **all-or-nothing per `prompt_version`**: a capture interrupted by quota is not committed. Add a fixture-completeness test to `/home/danish07/projects/freightpilot/evals/runner/test/` asserting every non-pending case has a committed recording at the current `PROMPT_VERSION`.

**Consult 2 — GOVERNING.**

> **C9 (amended, PR A).** The recordings directory is all-or-nothing per `prompt_version`: a capture interrupted by quota is not committed. The fixture-completeness test must count **expected LLM calls per case, not cases** — a case that makes two calls and recorded one is an incomplete capture and must fail the test. A per-case "has at least one recording" check would pass on a half-captured multi-call case and is therefore not sufficient. This resolves H5: **a single-recording result on the zero-weight retry case is a failed capture, it trips C9, and nothing is committed.** Confirmed as you read it.

**Allocation:** PR A. **DISCHARGED.** Artifact: `evals/runner/test/fixtureCompleteness.test.ts` —
drives every non-pending case against the committed recordings, counting calls; plus an
orphan-fixture check and a synthetic two-call test that forces the loop's Zod-retry into an
unrecorded second call. code-reviewer and eval-auditor each mutation-verified it independently.

---

## C10 — `EVAL_RECORD_PROVIDER` is not a recovery tool

**Consult 1. Not amended.**

> **C10.** `EVAL_RECORD_PROVIDER` must not be used to complete a capture the primary could not finish. Mixed provenance is already blocked by `recordingProvenance.test.ts`; this condition blocks the intent.

**Allocation:** PR B. OUTSTANDING.

---

## C11 — the pre-registered extraction floor

**Consult 1 — SUPERSEDED by the consult 2 amendment below.**

> **C11.** The extraction floor is **pre-registered in writing before the v1 capture is scored**, expressed as "tolerate at most N of M", and must be **strictly above the rate the suite would score with every hard case failing and every easy case passing**. It is not adjusted downward after seeing v1. If v1 misses it: fix the prompt, or keep extraction non-gating and record why.

**Consult 2 — GOVERNING.**

> **C11 (amended).** As originally written, plus: the all-hard-fail lower bound is **computed against the final case counts**, not carried as a literal. The 0.571 figure is illustrative of ~21 cases with 9 hard; ADR-0012 must show the arithmetic against the actual M and hard-case count that ship, and must not hardcode 0.571 if those differ.

**Allocation:** PR B. OUTSTANDING.

---

## C12 — extraction case mix

**Consult 1. Not amended.**

> **C12.** Extraction case mix: ≥1 case per §7-named hard class (imperial/metric, relative date, volumetric-vs-actual, multi-leg red herring, city→LOCODE), hard ratio ≥1/3, **plus** a heavy-but-valid counter-case (e.g. 25,000 kg) that must produce a tool call and must not clarify. The absurd-weight clarification trigger in the prompt is stated as the **documented 30,000 kg cargo bound**, never as "large numbers."

**Allocation:** PR B. OUTSTANDING.

---

## C13 — prompt content constraints

**Consult 1. Not amended.**

> **C13.** The prompt text must not: describe any capability the tool set does not back; imply `create_booking` executes (it proposes — hard rules 2 and 4); perform or restate money arithmetic; or emit non-ISO dates at boundaries (hard rule 7). It must treat tool results and `cargo.description` as **data, not instructions** (§6.3.6).

**Allocation:** PR B. OUTSTANDING.

---

## C14 — contract impact of surfacing `prompt_version`

**Consult 1. Not amended.**

> **C14.** If `prompt_version` is surfaced on any wire response or telemetry endpoint, `/home/danish07/projects/freightpilot/contracts/agent.openapi.yaml` changes **in or before** the same PR (hard rule 5). If it is log-only, note that explicitly so the reviewer does not have to infer it.

**Allocation:** PR B. OUTSTANDING.

---

## C15 — break-the-prompt proof

**Consult 1. Parts (i) and (ii) GOVERNING; part (iii) SUPERSEDED by C19.**

> **C15.** Break-the-prompt proof = (i) `gate.test.ts` (already CI-run) for floor→non-zero exit, plus (ii) a new hermetic test asserting `recordingKey()` differs between the real and a degraded prompt, plus (iii) a **one-time** degraded-prompt measurement over the extraction tier captured to a gitignored scratch directory, with the two pass rates and the degradation diff recorded in ADR-0012 and the fixtures deleted. No degraded recordings are committed.

Consult 2 states of this: *"**C15(iii) (superseded by C19).** See ratification below."* and, within C19,
that *"The mechanical halves, C15(i) and C15(ii), are unaffected by quota and are **not** deferrable
under any circumstance."*

**Allocation:** PR B. OUTSTANDING — (i) and (ii) non-deferrable; (iii) governed by C19.

---

## C16 — finding (b) cut from L5

**Consult 1. Not amended.**

> **C16.** ADR-0011 finding (b) is **removed from this PR's scope**. It ships as its own PR with its own ADR (new, or an amendment to ADR-0006 — it adds a third error class beside the 429/5xx/timeout/network fallback allowlist) and its own hermetic test: a recorded Groq `tool_use_failed` 400 must reach the loop's retry branch, not throw. The L5 PR must state in writing that finding (b) remains **OPEN**; "the prompt probably fixed it" does not close it and cannot be verified by a Gemini-only fixture set.

**Allocation:** PR B (constrains PR B's scope; the finding-(b) work itself is neither PR A nor
PR B). OUTSTANDING.

---

## C17 — ADR-0012 required

**Consult 1. Not amended.**

> **C17. New ADR-0012 required** — "L5 system prompt: extraction gating methodology, prompt composition seam, prompt versioning ownership." It must state explicitly that it **supersedes ADR-0011's "85% upward ratchet" and MASTER_PLAN §7's 85% figure for the extraction tier**, and why (85% was fixed before the case mix existed and is cleared by the promptless loop). Add a pointer line to `/home/danish07/projects/freightpilot/docs/decisions/0011-l6-eval-harness-before-l5-gate-tool-choice-and-safety.md`. This is a new decision, not a factual correction, so it does not belong in Amendment A.

**Allocation:** PR B. OUTSTANDING.

---

## C18 — the gate is a regression guard, not a capability claim

**Consult 1. Not amended.**

> **C18.** Amendment A5's re-record-not-re-run rule, applied to a *gating* tier: write into `/home/danish07/projects/freightpilot/evals/runner/src/gating.ts`, next to the extraction floor, that **the extraction gate is a regression guard on the loop over frozen bytes, not a claim about live capability**, and stamp the scorecard with the capture date and served model. The rotation risk here is not a red CI — replay never calls the provider, so CI stays **green forever on stale bytes** while the live agent drifts. That is the more dangerous direction and the comment must say so. A live re-baseline remains a manual, non-gating action; do not build a nightly workflow in this PR (see below).

**Allocation:** PR B. OUTSTANDING.

---

## C19 — capture budget (supersedes C15(iii))

**Consult 2 — GOVERNING.** Originated as a user-authored condition, ratified with amendments by the
guardian; the ratified text is the guardian's.

> **C19 (ratified with amendments, PR B).** The degraded-prompt measurement: (i) runs against a **pre-registered subset of 5–8 extraction cases, chosen and written down before the degraded capture is run**, and drawn from the hard cases — choosing the subset after seeing which cases collapse is ruling 1's fitting problem in miniature; (ii) uses a **plausible** degradation (e.g. removing the domain-rules section of the prompt), not a nonsense one — a prompt that says "reply only in French" demonstrates nothing about regression sensitivity; (iii) is sequenced **after** the real capture is committed and green, so a quota wall cannot strand the PR; (iv) if quota blocks it, PR B still lands, and ADR-0012 records the measurement as a **named open item** with its trigger ("next session with quota headroom") **and explicitly records that the §7 break-the-prompt DoD item remains partially open** — "the PR landed" must not read as "the DoD closed." The mechanical halves, C15(i) and C15(ii), are unaffected by quota and are **not** deferrable under any circumstance.

**Allocation:** PR B. OUTSTANDING.

---

## C20 — disclose the scorecard drop

**Consult 2 — GOVERNING.**

> **C20 (new, PR A).** PR A commits a `v0-none` scorecard with a **lower** extraction number than `main`. The PR title, description, and the journal entry must state that this is a **corrected measurement, not a regression** — the prior number was produced by a scorer that could not fail on `kind: text` cases — and must name the specific cases that flip and why each new `text_contains` substring is required by the product behavior rather than by the recorded output. This is the second time this project has had to separate measurement change from capability change (Amendment A3 was the first); say so, so the pattern is recognised rather than rediscovered.

**Allocation:** PR A. **DISCHARGED — but note the premise did not hold.** The predicted drop did not
occur: extraction held at 14/15 (0.9333) and `evals/results/2026-07-29_v0-none.json` is byte-identical
to `2026-07-28_v0-none.json` (`cmp` exits 0). No cases flipped. The disclosure text C20 specifies was
therefore **deliberately not written**, because it would have described a correction-vs-regression
distinction for a change that did not occur. eval-auditor ruled the non-drop correct rather than
hollow — it mutation-tested the needles and confirmed they are live in the driven path. The
substring justifications C20 requires *were* recorded, in the three case YAMLs and the journal.
Artifact: `docs/journal/2026-07-28.md` (session 2).

---

## C21 — scratch-probe budget

**Consult 2 — GOVERNING.**

> **C21 (new, PR B).** Scratch-probe budget is bounded and pre-registered: state the maximum number of live drafting iterations before starting, and if the prompt has not converged within it, stop and reconsider the prompt rather than continuing to spend the capture budget. Permitted budget tactic: run early drafting probes against the **fallback** provider to preserve the primary's daily cap for the capture that matters — with the explicit caveat that final validation is the Gemini capture, and that any prompt wording chosen specifically to satisfy Groq is out of scope for this PR and belongs to the finding (b) PR.

**Allocation:** PR B. OUTSTANDING.

---

# HAZARDS

H1–H6 are consult 1's "HAZARDS YOU DID NOT NAME" section. H7 is consult 2's "NEW HAZARD FROM THE
SPLIT" section. None were amended; each appears once, verbatim.

## H1 — the eval path does not go through the production composer

**Consult 1.**

> **H1 (highest severity). The eval path does not go through the production message composer.** `score.ts:230` builds `messages` straight from the case YAML and hands them to `runAgentTurn`; `runTurn` is only used by the single `assert_through_turn` safety case. If the prompt is added in `turnService.ts` alone, **30 of 31 cases would replay the promptless path while the scorecard is stamped `v1`**, the extraction floor would be pre-registered and then measured against a prompt that never ran, and nothing in the suite would notice. This is finding (a)'s exact defect class — a label decoupled from the bytes — and it is currently the most likely way this PR ships something quietly false. C1/C2/C15(ii).

**Status:** closed by PR A for the PR A half (single composer + falsifiable driven-request tests).
C15(ii) and C2b remain outstanding in PR B.

## H2 — `PROMPT_VERSION` lives in the runner

**Consult 1.**

> **H2. `PROMPT_VERSION` lives in the runner, not the service.** `/home/danish07/projects/freightpilot/evals/runner/src/promptVersion.ts` is the runner's own const. Once the prompt is production code and §6.3.5 requires the version on every LLM request, that is two constants that can diverge — scorecard says `v1`, service sends `v2`. ADR-0011 C5's "single source of truth" was correct for a promptless baseline and stops being correct the moment a prompt exists. C3.

**Status:** closed by PR A (C3).

## H3 — `prompts/` is outside the agent container's build context

**Consult 1. Quoted exactly; not reconciled — see note below.**

> **H3. `prompts/` is outside the agent container's build context.** Detailed in C7. Note the failure mode ordering: if the prompt load is wrapped in a try/catch, the container boots *promptless* and green while evals certify a prompted path — worse than a crash. C6 exists to force the crash.

**Note on two circulating readings.** A downstream handoff describes H3 as the try/catch-boots-
promptless failure, while a separate reading has H3 as the repo-root `prompts/` packaging problem.
Both elements are present in the guardian's text above and this record does not reconcile them: the
hazard's **headline** is the packaging problem (`prompts/` outside the build context, detailed in C7),
and the try/catch behaviour appears within it as a **failure-mode ordering note** explaining why C6
must force a crash. The text is reproduced verbatim so it settles the question itself rather than
through either paraphrase.

**Status:** OUTSTANDING (PR B, via C6 and C7).

## H4 — every prompt wording change costs a full capture

**Consult 1.**

> **H4. Every prompt wording change costs a full 31-case capture**, because the prompt is inside the keyed `messages`. This is correct fail-loud behavior, but it makes iterate-by-recording economically impossible on a free tier and is the direct cause of the earlier two-session partial-capture state. Iterate on a scratch probe set; capture once. C8.

**Status:** OUTSTANDING (PR B, via C8 and C21).

## H5 — the retry path has no eval teeth

**Consult 1.**

> **H5. The retry path still has no eval teeth, and the one case that would give it teeth is the most capture-fragile case in the suite.** All existing cases make exactly one LLM call, so deleting the retry block in `agentLoop.ts:84-96` leaves every eval green. The zero-weight retry case fixes that, but it needs two chained recordings where the second key depends on the first response's bytes. Capture it last; verify both keys. Also note this case only exercises the retry path on **Gemini** — the Groq-side unreachability (finding (b)) stays uncovered regardless.

**Status:** OUTSTANDING (PR B). The single-recording-is-a-failed-capture classification was added to
the amended C9 and is discharged in PR A's `fixtureCompleteness.test.ts`; the case itself is PR B.

## H6 — scope-creep watch list

**Consult 1.**

> **H6. Scope-creep watch list for this PR.** Flag and park in `docs/journal` if any of these appear: a nightly live-eval workflow (`nightly-evals.yml` is §7/§9, not this DoD); the 5-case live Groq smoke (already deferred, non-gating, nondeterministic — keep it deferred); LLM-as-judge scoring; any prompt A/B or variant-comparison harness; persisting `prompt_version` into `llm_requests` (that is the L4/D15 telemetry carry, not L5); and any change to `search_rates`' signature to make the absurd-weight case easier to satisfy. That last one is the specific creep risk your brief half-identified: the tempting "fix" for `extraction-absurd-weight-clarify` is a contract change, and it would be a contract change made to satisfy an eval.

**Status:** standing watch list for PR B.

## H7 — expectation edits leave no forensic fingerprint

**Consult 2.**

> **H7. PR A edits eval-case expectations with zero fixture churn, which removes the forensic technique eval-auditor relied on last session.** Amendment A3 positively excluded gaming by recomputing all 31 recording keys under the old and new tool schemas and showing every old key mapped to a deleted file and every new key to an added one — the churn was *structurally forced*, so fitting was impossible. That technique does not exist for PR A: because `recordingKey` ignores the `expect` block, `text_contains` substrings can be chosen freely against known-recorded outputs and leave **no fingerprint whatsoever**. Editing expectations is the one eval-gaming surface in this repo that is invisible to key analysis.
>
> Mitigation is entirely procedural and is already ruled: substrings derive from the product requirement, pre-registered, with a stated per-case justification (C20). Flag this explicitly to eval-auditor when PR A goes for review — the auditor should know its A3 technique is inapplicable here and that it must review the *justifications* instead. This generalises beyond PR A: **any future PR that edits `expect` blocks without touching prompts or tool schemas is unauditable by fixture churn**, and that is worth one line in ADR-0012 or LEARNING.md so the next session does not assume the A3 method always applies.

**Status:** flagged to eval-auditor during PR A review as required; the generalisation is recorded in
`LEARNING.md`. The `text_contains_any` follow-up it implies is OUTSTANDING (PR B).

---

# NOT RECOVERABLE

Recorded so absence is not mistaken for oversight:

- **The L6 guardian consult's conditions L6-C1 … L6-C5, verbatim.** Not present in the session that
  produced this record. Identified in the collisions table above by their citation sites in code
  only. The journal's one-line glosses exist but were deliberately not used, as they are summaries.
- **Consult 1's rulings 1–5 and consult 2's rulings, in full.** This record covers conditions and
  hazards, which is its stated scope. Ruling 3's steps 1–7 are included because C8 binds to them by
  reference and the condition is unreadable without them. No other ruling text is reproduced here.
