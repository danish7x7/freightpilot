# evals/cases

One YAML file per case. The schema is `evals/runner/src/caseSchema.ts`; a malformed case is a hard
error on load, never a silent skip.

**Cases are code.** They go through a PR, they are gated by eval-auditor, and a change to an `expect`
block is a change to what the gate measures.

## Writing an expectation

`kind: text` cases assert with needle groups. Two forms, normalized identically by `toNeedleGroups`:

- `text_contains: [a, b]` requires every substring.
- `text_contains_any: [[a, b], [c]]` is a list of OR groups. Alternatives within a group are ORed,
  groups are ANDed.

Prefer `text_contains_any` whenever more than one wording satisfies the requirement. A single
substring asserts a **vocabulary choice**; the rule you actually mean is almost always broader than
one word, and pinning the word rather than the rule creates a cheap way to pass the case by writing
that word into the prompt.

**Every substring carries a one-line justification in the case file, and for an OR group every
alternative carries its own line.** The justification names the product requirement the substring
follows from. It never describes what a model said.

### The rule this is protecting against

`recordingKey` hashes the messages, the tool schemas, and `prompt_version`. It does **not** hash the
`expect` block. So an expectation can be edited to match a known recorded output and the fixture set
does not change at all: no churn, no fingerprint, nothing for a reviewer to recompute. That is
guardian hazard H7, and the mitigation is entirely procedural. It rests on the alternatives being
**fixed before any output is read**, which is a claim about process that only the PR description and
these justifications can carry.

Amendment A3's technique of recomputing recording keys to prove that churn was structurally forced
does not apply to expectation edits. There is nothing to recompute.

## The clarification rule

> A clarification must NAME the field it cannot proceed without.

Several `kind: text` cases assert this: missing destination, unresolvable origin, an unresolvable
port code, a relative date with no reference date. All of them check that the answer identifies
**which** input is unusable, because "I need more information" leaves the user with nothing to fix.

**This is an eval-authored operationalization of §7, not pre-existing product doctrine.** MASTER_PLAN
§7 requires only that absurd or missing values "trigger clarification not extraction". It does not
say the clarification must name the field. That refinement was chosen here, by the eval suite,
because the weaker reading is not scoreable: any non-empty string is a clarification, so a tier
gating on the weaker rule gates on nothing.

Recording it as though §7 already said it would be a small version of the provenance defect this
layer exists to close, so it is written down here as an eval decision with an author and a reason.
ADR-0012 carries it. If the product later disagrees, the cases change, not this note's history.
