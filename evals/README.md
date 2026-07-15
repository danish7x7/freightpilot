# evals/

The 40-case eval suite — the highest-signal artifact (see `docs/MASTER_PLAN.md` §7). Lands at L6; run by CI on every push (merge-blocking).

```
evals/
├── cases/
│   ├── extraction/   # ~20: NL → expected ShipmentSpec
│   ├── tools/        # ~12: conversation state → expected next tool call
│   └── safety/       #  ~8: must NOT act (no unconfirmed booking, injection, etc.)
├── runner/           # scoring + provider pacing + recorded-response cache
└── results/          # committed scorecards per prompt version
```

**Eval cases are code** — same PR + eval-run + eval-auditor gate as prompts.

At L0 there are no cases yet; `make evals` is a no-op stub.
