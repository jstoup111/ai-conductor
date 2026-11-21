---
name: simplify
implicit_invocation: required
description: "Use only at an active pipeline batch boundary after code has changed, or for the required whole-feature pass before BUILD completes. Reviews duplication, complexity, over-engineering, and domain-modelling defects; do not invoke for ordinary refactors, code review, or requests that merely ask for simpler prose or code."
enforcement: gating
phase: build
standalone: false
requires: []
model: sonnet
---

## Purpose

Runs at pipeline batch boundaries. Catches accumulated duplication, complexity,
over-engineering, and domain-modelling defects before they compound across batches. Enforces "dry business logic, not dry code"
— extract shared *behavior*, not shared *shape*.

This is NOT a full codebase audit. It is scoped to the current batch's changes, except
that changed tests must be compared with existing tests at the same production seam.

It also runs once in **whole-feature mode** before BUILD first hands off to `build_review`. The
engine enforces that pass: BUILD does not complete until its record ends `## Verdict: CLEAN`.

## Whole-feature mode

Run this mode once, after every plan task is committed and before BUILD completes. Batch records
do not satisfy it.

- **Scope.** The whole feature diff, `git diff $(git merge-base HEAD <base>)...HEAD`, where `<base>`
  is the branch the feature merges into (for a stacked child, its parent branch). Apply §2–§8 to
  every changed file, not only the last batch.
- **Kinds.** Apply every kind the `build-review-implementation-quality` rubric judges, with that
  skill's definitions and non-finding clauses exactly as its Judgement section states them (§7).
  This pass is that rubric's first pass over the same diff, so a finding it would raise is fixed
  here instead of costing a review lap.
- **Fix, then record.** Fix every must-fix finding in its own commits, re-check the changed hunks,
  and record advisory findings with their reasons.
- **Output.** Write `.pipeline/audit-trail/feature-simplification.md`; for an active stacked child
  `k`, write `.pipeline/audit-trail/child-<k>-simplification.md`. Use the §9 format with the range
  `<merge-base>...HEAD`. The record must end `## Verdict: CLEAN`; a `SIMPLIFY_REQUIRED` record
  leaves BUILD incomplete until the findings are fixed and the record is rewritten.

The record persists across remediation laps, so later BUILD laps do not repeat the pass.

## Practices

### 1. Scope Detection

Identify files changed in the current batch:

```bash
git diff <batch-start-commit>..HEAD --name-only
```

Keep non-test analysis limited to these files. For each changed or added test, additionally
inspect existing tests at the same production seam; do not scan unrelated code or tests.
Derive the batch-start commit from the last batch entry in `.pipeline/progress.log` (the commit
before that batch's first task commit).

### 2. Duplication Check

Look for duplicated **business logic** across batch-changed files. Distinguish between:

| Type | Example | Action |
|------|---------|--------|
| Duplicated behavior | Same validation logic in two services | Must extract |
| Duplicated shape | Two serializers with similar structure | Leave alone |
| Copy-paste with tweaks | Same method with 1-2 param differences | Extract with parameters — except a declared replication's exact mapped source/target pair alone is not an extract-with-parameters finding. Still flag undeclared duplication or similarity outside the declared target set; with no declaration, apply this row unchanged. A declared pair may retain an extraction finding when rationale beyond the declared replication merits it. |

Flag the second copy of non-trivial behavior, and any changed block that reimplements an existing
repository helper; implementationQuality flags both.

Before recommending extraction, inlining, or a competing abstraction, consult the applicable
focused pattern basis (for example, the approved plan, architecture decision, or declared
replication contract). Flag only a material, unapproved departure from that basis. Accept a
variation the basis allows, a verified case where the proposed extraction does not fit the accepted
design, or a departure that the operator or accepted artifact explicitly authorizes. This alignment
check does not turn shared shape into shared behavior: extract only shared business behavior.

### 3. Complexity Check

Flag methods that exceed these thresholds:

| Metric | Threshold | What It Means |
|--------|-----------|---------------|
| Conditional branches | >4 per method | Too many paths to reason about |
| Method length | >25 lines | Doing more than one thing |
| Nesting depth | >3 levels | Extract inner logic |
| Parameter count | >4 parameters | Consider parameter object |

These are guidelines, not absolutes. A 26-line method that reads clearly is fine.
A 15-line method with 5 nested conditionals is not.

### 4. Extract-Worthy Patterns

Identify patterns that should be extracted:

- 3+ similar code blocks across different files
- Repeated parameter lists passed between methods
- Identical error handling blocks
- Common setup/teardown patterns in non-test code

**Do not flag test setup duplication** — test readability trumps DRY in specs.

### 5. Test and Implementation Value

For every changed or added test, inspect existing tests at the same production seam even
when those tests are outside the batch. Duplicate cases are must-fix unless they prove a
distinct failure boundary and state that boundary in the test.

Reject as must-fix:

- Tautologies, no-op assertions, and assertions of test-local constants
- No-signal tests that cannot plausibly detect a production regression
- Cast-only or annotation-only type tests when the test suite is not semantically typechecked
- Tests that validate mock behavior rather than production behavior
- Tests of ordinary human-facing documentation wording, headings, links, or source layout
- Tests retained only to mirror a historical plan or decision whose behavior has been superseded
- Implementations that exist only to satisfy low-value assertions

Machine-consumed or generated-document contracts are valid only when the test verifies the
resulting runtime behavior. Production-file mirroring is not an independent reason to retain a
test: every test must plausibly fail under a production regression, and every implementation must
trace to an operator outcome or acceptance criterion.
When removing a no-signal test exposes an apparent coverage gap, resolve it against the current
governing contract before adding a replacement; do not recreate behavior from a superseded artifact.

### 6. Over-Engineering Detection

Flag abstractions that add complexity without value:

| Pattern | Problem | Fix |
|---------|---------|-----|
| Single-caller abstraction | Indirection without reuse | Inline it |
| Wrapper that just delegates | No added behavior | Remove wrapper |
| Config-driven with one config | Premature generalization | Hardcode it |
| Interface with one implementer | Speculative abstraction | Remove interface (unless ADR justifies) |

**Exception:** If an ADR in `.docs/decisions/` explicitly justifies the abstraction
(e.g., "interface for future payment providers"), do not flag it.

Before recommending an inline or replacement abstraction, apply the focused pattern-basis check
from Duplication Check. Do not raise an independent finding for a variation, verified no-fit
decision, or authorized departure that the applicable basis already permits.

### 7. Domain-Modelling Check

`build_review`'s `implementationQuality` rubric enforces a closed vocabulary of implementation and
domain-modelling defects across the whole feature diff. That rubric stays the authority, and its
definitions are not restated here: read the `build-review-implementation-quality` skill's Judgement
section (its `SKILL.md` in the harness `skills/` catalog, installed under `~/.claude/skills/` and
`~/.agents/skills/`) and apply each kind
with its non-finding clause as written there. Duplication (§2) and complexity (§3) cover
`duplication` and `excess-complexity`; check changed code for every other kind that section lists.
This check is the build's good-faith first pass: catch the concrete cases while the code is fresh, so
they do not each cost a review lap later.

Report only concrete defects you can point to in a changed hunk: name the invalid state, the
dropped case, or the confused value. Do not report style preferences, hypothetical risks, plan or
acceptance conformance, or defects in code outside the reviewed range.

**Carry decisions forward.** Before reporting, read the earlier
`.pipeline/audit-trail/batch-*-simplification.md` files. Do not re-raise a finding an earlier batch
fixed or recorded as advisory with a reason, unless this batch changed that code again. Record every
finding you leave unfixed as advisory with its reason, so later batches and reviewers can see the
decision.

### 8. Dead Code Detection

Check for code added in this batch that is never called:

- Methods/classes defined but not referenced
- Imports added but unused
- Conditional branches that can never be reached

Use the linter output if available (tech-context may specify one). Otherwise, grep for
references to each new symbol.

### 9. Output

Write findings to `.pipeline/audit-trail/batch-N-simplification.md`: the batch commit range, one
table of findings (`# | Category | Kind | Description | File:Line | Fix | Severity`, where Category is
one of duplication, complexity, extract-worthy, over-engineering, domain-modelling, dead-code, or
test-value; Kind is the domain-modelling kind or complexity metric; Fix is the recommendation or
extraction target; and Severity is `must-fix` or `advisory (reason)`), then
`## Verdict: CLEAN | SIMPLIFY_REQUIRED` with must-fix and advisory counts.

### 10. Verdict and Gating

| Verdict | Condition | Action |
|---------|-----------|--------|
| **CLEAN** | Zero must-fix items | Proceed to next batch |
| **SIMPLIFY_REQUIRED** | One or more must-fix items | Fix before next batch; counts toward rework budget |

Advisory items are noted but do not block.

Rework from simplification counts toward the pipeline rework budget (3 cycles per task).

## Verification

- [ ] Analysis limited to batch files (plus same-seam tests for changed tests)
- [ ] Applicable pattern basis consulted before recommending extraction or inlining
- [ ] Earlier batches' simplification records read; settled findings not re-raised
- [ ] Output written to `.pipeline/audit-trail/batch-N-simplification.md` with a verdict
- [ ] Before BUILD completes, one whole-feature pass over `<merge-base>...HEAD` wrote the feature or
      child record ending `## Verdict: CLEAN`
