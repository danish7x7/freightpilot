# FreightPilot Agent System — Setup & Wiring

Drop-in bundle for the `freightpilot` repo. Copy the contents of this folder into the repo root:

```
freightpilot/
├── .claude/agents/          # 6 subagent definitions (Claude Code auto-discovers these)
│   ├── security-reviewer.md
│   ├── code-reviewer.md
│   ├── debugger.md
│   ├── architecture-guardian.md
│   ├── eval-auditor.md
│   └── scribe.md
├── LEARNING.md              # learning log (scribe-maintained)
└── docs/
    ├── decisions/0000-adr-template.md
    └── journal/0000-template.md
```

Claude Code picks up anything in `.claude/agents/` automatically. Verify with `/agents` in the CLI. Each file's `description` field tells the main agent when to delegate; the "use PROACTIVELY" phrasing makes delegation happen without you asking.

## The six agents and their triggers

| Agent | Trigger | Blocks progress? |
|---|---|---|
| architecture-guardian | BEFORE starting a layer/endpoint/refactor; phase exits | FAIL blocks |
| code-reviewer | AFTER completing a feature, before commit | REQUEST CHANGES blocks commit |
| security-reviewer | after agent-layer/gate/API/config/dep changes; phase exits | FAIL blocks |
| debugger | any failing test, error, provider-difference weirdness | no (diagnostic) |
| eval-auditor | eval case changes, prompt changes, surprising pass-rate moves | COMPROMISED blocks |
| scribe | END of every session; after decisions; after bad bugs | no (but non-optional habit) |

## The working loop per feature

```
design → architecture-guardian (pre-check)
   → implement (main Claude Code session)
   → code-reviewer → fix findings
   → security-reviewer (if in its trigger scope) → fix findings
   → commit/PR (CI runs tests + evals)
   → scribe at session end
```

Phase exits additionally run: architecture-guardian + security-reviewer + eval-auditor, then the external claude.ai reviewer session gets their three verdicts as input.

## Add this block to CLAUDE.md

```markdown
## Subagent protocol
- Before implementing any new layer, endpoint, or refactor: consult architecture-guardian.
- After completing any feature and before committing: run code-reviewer; fix Blocking items before commit.
- After changes touching agent layer, confirmation gate, APIs, env/config, or deps: run security-reviewer. FAIL blocks merge.
- On any failing test/error/odd agent behavior: hand to debugger; implement its MINIMAL FIX and REGRESSION GUARD.
- On prompt or eval changes: run eval-auditor before merging.
- At the end of EVERY session: run scribe (journal + LEARNING.md + ADRs). Sessions without a scribe pass are incomplete.
- Phase exits require: architecture-guardian PASS, security-reviewer PASS, eval-auditor SOUND (Phase 2+), then external review.
- Subagents report findings; the main session implements fixes. Only scribe writes docs.
```

## Notes

- **Model choice:** you can pin cheaper/faster models per agent by adding `model:` to the frontmatter (e.g. the scribe and debugger don't need your strongest model). Left unset, they inherit the session model.
- **Don't over-invoke:** guardian and security on every trivial edit will slow you down. The trigger table is the contract — trust it.
- **The scribe is the job-search multiplier:** LEARNING.md + journal + ADRs + post-mortems are exactly the artifacts that turn "I built a project" into interview stories with receipts. Treat the session-end scribe pass as non-negotiable, same as you did with terminal-agent-lab's decision notes.
