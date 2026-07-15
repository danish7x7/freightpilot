# prompts/

Versioned system prompts and tool descriptions for agent-service (`v1_system.md`, `v2_system.md`, …). These land at L5.

**Prompt files are code.** Any change:

- goes through a **PR** — never edited directly on `main`;
- must **run the eval suite** (`make evals`) with the resulting scorecard committed to `evals/results/`;
- is gated by **eval-auditor** before merge;
- carries a `prompt_version` logged on every LLM request and stamped into every scorecard.

See `docs/MASTER_PLAN.md` §6 and the "Prompts and eval cases are code" section of `CLAUDE.md`.
