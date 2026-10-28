---
name: simplify
implicit_invocation: required
description: "Use only at an active pipeline batch boundary after code has changed. Reviews current-batch duplication, complexity, over-engineering, and domain-modelling defects; do not invoke for ordinary refactors, code review, or requests that merely ask for simpler prose or code."
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

## Practices

### 1. Scope Detection

Identify files changed in the current batch:

```bash
git diff <batch-start-commit>..HEAD --name-only
```

Keep non-test analysis limited to these files. For each changed or added test, additionally
inspect existing tests at the same production seam; do not scan unrelated code or tests.
The batch-start commit is available from `.pipeline/audit-trail/batch-N/` or from the
pipeline's progress log.

### 2. Duplication Check

Look for duplicated **business logic** across batch-changed files. Distinguish between:

| Type | Example | Action |
|------|---------|--------|
| Duplicated behavior | Same validation logic in two services | Must extract |
| Duplicated shape | Two serializers with similar structure | Leave alone |
| Copy-paste with tweaks | Same method with 1-2 param differences | Extract with parameters — except a declared replication's exact mapped source/target pair alone is not an extract-with-parameters finding. Still flag undeclared duplication or similarity outside the declared target set; with no declaration, apply this row unchanged. A declared pair may retain an extraction finding when rationale beyond the declared replication merits it. |

Flag when 3+ similar blocks exist across different files. Two similar blocks in the same
file are a judgment call — flag only if the logic is non-trivial.

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
domain-modelling defects across the whole feature diff (see the `build-review-implementation-quality`
skill's Judgement section for each kind and its non-finding). That rubric stays the authority. This
check is the build's good-faith first pass: catch the concrete cases in this batch while the code is
fresh, so they do not each cost a review lap later. Duplication (§2) and complexity (§3) already
cover two kinds. Check batch-changed code for the other five:

| Kind | Must-fix when the batch... | Not a finding |
|------|----------------------------|---------------|
| `representable-invalid-state` | adds a state shape that can hold a contradictory or meaningless combination (two fields that can disagree, independently optional fields that must appear together) | invalid combinations are impossible at construction |
| `non-exhaustive-domain-match` | adds a branch over a closed domain (union, enum, event kind) that silently drops a meaningful case | an exhaustive match, or an explicit default that preserves the remaining cases |
| `primitive-obsession` | encodes a domain concept with invariants (an identity, a path component, a slug, a count with a unit) as a bare primitive that callers can confuse or misuse | the primitive's range and meaning are enforced where it is used |
| `obscured-intent` | hides the domain operation it performs (a hidden second return value, a computed value that is discarded and recomputed) | a local detail with a clear name and boundary |
| `non-semantic-name` | gives a public or domain name a meaning other than its role, or reuses one name for two concepts | a conventional iterator or a private temporary |

Report only concrete defects you can point to in a batch-changed hunk: name the invalid state, the
dropped case, or the confused value. Do not report style preferences, hypothetical risks, plan or
acceptance conformance, or defects in code this batch did not change.

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

Write findings to `.pipeline/audit-trail/batch-N-simplification.md`:

```markdown
# Simplification Check: Batch N

**Date:** YYYY-MM-DD
**Files analyzed:** [count]
**Batch commits:** <start-commit>..<end-commit>

## Findings

### Duplication
| # | Description | Files | Severity |
|---|-------------|-------|----------|
| 1 | [description] | [file1:line, file2:line] | must-fix / advisory |

### Complexity
| # | Method | File:Line | Issue | Metric |
|---|--------|-----------|-------|--------|
| 1 | [method_name] | [file:line] | [too many branches / too long / too nested] | [value] |

### Extract-Worthy Patterns
| # | Pattern | Occurrences | Suggested Extraction |
|---|---------|-------------|---------------------|
| 1 | [description] | [file1:line, file2:line, file3:line] | [extract to where] |

### Over-Engineering
| # | Abstraction | File:Line | Callers | Recommendation |
|---|-------------|-----------|---------|----------------|
| 1 | [class/method] | [file:line] | [count] | [inline / remove / keep with justification] |

### Domain Modelling
| # | Kind | File:Line | Defect | Severity |
|---|------|-----------|--------|----------|
| 1 | [representable-invalid-state / non-exhaustive-domain-match / ...] | [file:line] | [the invalid state, dropped case, or confused value] | must-fix / advisory (reason) |

### Dead Code
| # | Symbol | File:Line | Reason Unused |
|---|--------|-----------|---------------|
| 1 | [symbol] | [file:line] | [no callers / unreachable branch] |

### Test and Implementation Value
| # | Test/Implementation | File:Line | Value Violation | Severity |
|---|---------------------|-----------|-----------------|----------|
| 1 | [name] | [file:line] | [duplicate/no-signal/no outcome trace] | must-fix |

## Verdict: CLEAN | SIMPLIFY_REQUIRED

**Must-fix items:** [count]
**Advisory items:** [count]
```

### 10. Verdict and Gating

| Verdict | Condition | Action |
|---------|-----------|--------|
| **CLEAN** | Zero must-fix items | Proceed to next batch |
| **SIMPLIFY_REQUIRED** | One or more must-fix items | Fix before next batch; counts toward rework budget |

Advisory items are noted but do not block.

Rework from simplification counts toward the pipeline rework budget (3 cycles per task).
If the rework budget is exhausted, escalate to user.

## Verification

- [ ] Non-test analysis limited to current batch files (not the full codebase)
- [ ] Duplication checked across batch-changed files (behavior, not shape)
- [ ] Applicable focused accepted basis consulted before extraction, inlining, or a competing abstraction; only material unapproved departures flagged
- [ ] Allowed variations, no-fit decisions, and authorized departures accepted; declared exact-replication and business-behavior-vs-shape distinctions retained
- [ ] Complexity thresholds applied (>4 branches, >25 lines, >3 nesting, >4 params)
- [ ] Extract-worthy patterns identified (3+ similar blocks)
- [ ] Over-engineering flagged (single-caller abstractions, unnecessary indirection)
- [ ] ADR exceptions respected (documented abstractions not flagged)
- [ ] Domain-modelling check run on batch-changed code for the five kinds in §7; concrete defects marked must-fix
- [ ] Earlier batches' simplification records read; fixed or advisory findings not re-raised unless their code changed again
- [ ] Dead code in batch detected
- [ ] Changed/added tests compared only with existing tests at the same production seam, including outside the batch when needed
- [ ] Distinct failure boundaries stated for any intentionally overlapping tests
- [ ] Tests can plausibly fail on production regressions; no no-signal, tautology, mock-only, type-only, superseded-behavior, or documentation-wording/layout assertions
- [ ] Production-file mirroring is not treated as an independent reason to retain a test
- [ ] Apparent coverage gaps checked against the current governing contract, not preserved from superseded artifacts
- [ ] Implementations trace to an operator outcome or acceptance criterion
- [ ] Test and Implementation Value findings included; violations marked must-fix
- [ ] Output written to `.pipeline/audit-trail/batch-N-simplification.md`
- [ ] Verdict issued (CLEAN or SIMPLIFY_REQUIRED)
