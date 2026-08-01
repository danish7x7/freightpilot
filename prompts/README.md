# prompts/

Versioned system prompts for agent-service (`v1_system.md`, `v2_system.md`, …).

`v1_system.md` landed at L5. It is the SOURCE OF TRUTH and is embedded into the service at build
time by `services/agent/scripts/gen-prompt.ts`, which emits a committed `src/prompt/*.gen.ts`; CI
regenerates and fails on any drift. Nothing reads this directory at runtime, because it sits
outside the agent container's docker build context.

**Prompt files are code.** Any change:

- goes through a **PR** — never edited directly on `main`;
- must **run the eval suite** (`make evals`) with the resulting scorecard committed to `evals/results/`;
- is gated by **eval-auditor** before merge;
- carries a `prompt_version` logged on every LLM request and stamped into every scorecard.

See `docs/MASTER_PLAN.md` §6 and the "Prompts and eval cases are code" section of `CLAUDE.md`.
