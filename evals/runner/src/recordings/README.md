# evals/runner/src/recordings/ — committed replay fixtures

**These are the committed `v1` fixture set**, captured 2026-08-02 from `gemini-3.1-flash-lite`.
They are the bytes the extraction, tools and safety gates score against.

Each file is `<sha256>.json`: a normalized `ChatResponse` captured from the real provider chain
(record mode), keyed by a hash over `{prompt_version, messages, tools}` (see `../recordingKey.ts`).
CI replays these — **zero API calls** — and a replay **miss is a hard error**, never a live call.

## History: the v0-none set is gone

This directory previously held 30 `v0-none` recordings captured before a system prompt existed.
L5 introduced one, which changed `messages` and bumped `PROMPT_VERSION`, so every one of those keys
became unreachable. They were purged in `32e8ff8` rather than left as orphans, because L5-C9 makes
this directory **all-or-nothing per `prompt_version`** and a directory holding two generations
cannot satisfy that.

The same rule governs the current set: when the prompt changes again, these all invalidate together
and are re-captured in one pass. Provenance for the current set is in `../recordings.meta.json`.

## Re-capturing

Manual, opt-in, needs real free-tier keys in `services/agent/.env` (never committed):

```
cd evals/runner && pnpm run record      # EVAL_RECORD=1 tsx src/run.ts
```

Capture is paced two ways so a bulk run stays inside the free tier (both record-mode ONLY —
strict no-ops in replay/CI):

| env | default | what it paces |
|---|---|---|
| `EVAL_RECORD_RPM` | `12` | requests/min WITHIN a case (token bucket, capacity 1) |
| `EVAL_RECORD_DELAY_MS` | `5000` | sleep BETWEEN cases (multi-turn cases fire several calls each) |
| `EVAL_RECORD_PROVIDER` | primary | chain entry to capture from, BY NAME — override only |

`EVAL_RECORD_PROVIDER` exists for one-off comparison captures. Do not reach for it to work around
a primary-side error: capturing the baseline from the fallback is precisely ADR-0011 finding (a),
where `exclusiveMinimum` 400'd Gemini non-retryably and 30 fixtures came from Groq while the suite
reported green. Fix the request instead. `test/recordingProvenance.test.ts` now fails if the
committed set is anything other than single-provider Gemini.

Record mode wraps the **real** primary provider so recordings reflect real normalization. Only the
normalized `ChatResponse` fields are persisted: no auth headers and no API keys, which live below
the normalization seam. Record mode **never runs in PR CI**.

`thoughtSignature` USED to be listed here as a third thing that could not leak, and as of ADR-0013
it is deliberately preserved instead. See the section at the end of this file for why that reversal
is forced rather than chosen.

### `servedModel`: what answered, versus `model`, what we asked for

`model` is the configured alias echoed back from `LLM_CHAIN`, so every Gemini recording reads
`gemini-flash-latest` whatever ran underneath it. `servedModel` is read from the response itself
(Gemini's `modelVersion`; the top-level `model` on OpenAI-compatible providers) and records the
version that actually served. The scorecard stamps the sorted distinct set as `served_models`, so a
capture that spans a rotation shows **two** entries rather than silently picking one.

Measured 2026-07-31: **Groq echoes the requested id** rather than resolving it, so on the Groq leg
`servedModel` equals `model` and adds nothing. That is a known asymmetry, not a bug. It is captured
anyway so the echo is visible as an echo, and so a provider that later starts resolving needs no
envelope change.

### Re-baselining after an alias rotation: purge first

**`pnpm run record` will NOT refresh existing recordings.** Record mode skips any key that already
has a fixture, which is what makes an interrupted capture resumable without re-paying for cases
already captured. The consequence: if the alias rotates but the prompt does not, every key is
unchanged, a re-record makes **zero live calls**, and the stale bytes survive while `served_models`
keeps stamping the old version confidently.

ADR-0011 Amendment A5 requires a re-**record**, not a re-run, when the primary or the alias target
changes. To actually perform one:

```
rm -f evals/runner/src/recordings/*.json && cd evals/runner && pnpm run record
```

`servedModel` makes a rotation **auditable** (it is in the bytes to be compared) but not
**self-detecting**. Purging is the operator's step and there is no guard that will do it for you.

## `thoughtSignature` in these fixtures (ADR-0013)

Recordings of a tool call served by a Gemini thinking model carry a `thoughtSignature`: an opaque,
high-entropy base64 token the provider issues and **requires echoed back** when that assistant turn
is re-sent. It is preserved here deliberately, not by oversight. `recordingKey` hashes
`req.messages`, and a retry appends the assistant tool call to the conversation, so the signature is
inside the key material of the next call. A stripped set would replay to a different key and miss its
own fixture.

Two things follow for anyone touching this directory.

**It is not a credential.** No account authority, scoped to one response, never parsed by this
codebase. security-reviewer assessed it and returned PASS.

**It will trip generic-secret scanners.** If an allowlist becomes necessary, scope it to the
`thoughtSignature` **field name**, never to this directory. A directory-wide allowlist is exactly
what would later hide a real key committed here by accident.
