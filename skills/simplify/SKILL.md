---
name: simplify
description: "Review changed code for duplication, complexity, and over-engineering at batch boundaries. Blocking gate — must pass before next batch proceeds."
enforcement: gating
phase: build
standalone: false
requires: []
model: sonnet
---

## Purpose

Runs at pipeline batch boundaries. Catches accumulated duplication, complexity, and
over-engineering before they compound across batches. Enforces "dry business logic, not dry code"
— extract shared *behavior*, not shared *shape*.

This is NOT a full codebase audit. It is scoped to the current batch's changes only.

## Practices

### 1. Scope Detection

Identify files changed in the current batch:

```bash
git diff <batch-start-commit>..HEAD --name-only
```

Only analyze these files. Do not scan the full codebase — that would be slow and noisy.
The batch-start commit is available from `.pipeline/audit-trail/batch-N/` or from the
pipeline's progress log.

### 2. Duplication Check

Look for duplicated **business logic** across batch-changed files. Distinguish between:

| Type | Example | Action |
|------|---------|--------|
| Duplicated behavior | Same validation logic in two services | Must extract |
| Duplicated shape | Two serializers with similar structure | Leave alone |
| Copy-paste with tweaks | Same method with 1-2 param differences | Extract with parameters |

Flag when 3+ similar blocks exist across different files. Two similar blocks in the same
file are a judgment call — flag only if the logic is non-trivial.

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

### 5. Over-Engineering Detection

Flag abstractions that add complexity without value:

| Pattern | Problem | Fix |
|---------|---------|-----|
| Single-caller abstraction | Indirection without reuse | Inline it |
| Wrapper that just delegates | No added behavior | Remove wrapper |
| Config-driven with one config | Premature generalization | Hardcode it |
| Interface with one implementer | Speculative abstraction | Remove interface (unless ADR justifies) |

**Exception:** If an ADR in `.docs/decisions/` explicitly justifies the abstraction
(e.g., "interface for future payment providers"), do not flag it.

### 6. Dead Code Detection

Check for code added in this batch that is never called:

- Methods/classes defined but not referenced
- Imports added but unused
- Conditional branches that can never be reached

Use the linter output if available (tech-context may specify one). Otherwise, grep for
references to each new symbol.

### 7. Output

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

### Dead Code
| # | Symbol | File:Line | Reason Unused |
|---|--------|-----------|---------------|
| 1 | [symbol] | [file:line] | [no callers / unreachable branch] |

## Verdict: CLEAN | SIMPLIFY_REQUIRED

**Must-fix items:** [count]
**Advisory items:** [count]
```

### 8. Verdict and Gating

| Verdict | Condition | Action |
|---------|-----------|--------|
| **CLEAN** | Zero must-fix items | Proceed to next batch |
| **SIMPLIFY_REQUIRED** | One or more must-fix items | Fix before next batch; counts toward rework budget |

Advisory items are noted but do not block. They feed into the micro-retro.

Rework from simplification counts toward the pipeline rework budget (3 cycles per task).
If the rework budget is exhausted, escalate to user.

## Verification

- [ ] Scope limited to current batch files only (not full codebase)
- [ ] Duplication checked across batch-changed files (behavior, not shape)
- [ ] Complexity thresholds applied (>4 branches, >25 lines, >3 nesting, >4 params)
- [ ] Extract-worthy patterns identified (3+ similar blocks)
- [ ] Over-engineering flagged (single-caller abstractions, unnecessary indirection)
- [ ] ADR exceptions respected (documented abstractions not flagged)
- [ ] Dead code in batch detected
- [ ] Output written to `.pipeline/audit-trail/batch-N-simplification.md`
- [ ] Verdict issued (CLEAN or SIMPLIFY_REQUIRED)
