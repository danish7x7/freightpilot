# evals/runner/src/recordings/ — committed replay fixtures

**These are THROWAWAY `v0-none` recordings.** Do not treat them as durable.

Each file is `<sha256>.json`: a normalized `ChatResponse` captured from the real provider chain
(record mode), keyed by a hash over `{prompt_version, messages, tools}` (see `../recordingKey.ts`).
CI replays these — **zero API calls** — and a replay **miss is a hard error**, never a live call.

## Why throwaway

`prompt_version` is currently `v0-none`: the D14 turn boundary drives the loop with the user
message + tool schemas alone, **no system prompt** (`turnService.ts:55-57`). When the **L5 prompt
PR** introduces a system prompt, the `messages` change *and* `PROMPT_VERSION` bumps — so **every key
here invalidates** and the whole set must be re-captured. Nobody should build on these bytes.

## Re-capturing

Manual, opt-in, needs real free-tier keys in `services/agent/.env` (never committed):

```
cd evals/runner && pnpm run record      # EVAL_RECORD=1 tsx src/run.ts
```

Record mode wraps the **real** primary provider so recordings reflect real normalization. Only the
normalized `ChatResponse` fields are persisted (no auth headers, no API keys, no Gemini
`thoughtSignature` — those live below the normalization seam). Record mode **never runs in PR CI**.
