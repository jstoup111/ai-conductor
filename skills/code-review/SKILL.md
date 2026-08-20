---
name: code-review
description: "Use after implementing a task, before merging, or when requesting quality verification. Dispatches an evaluator agent with fresh context for calibrated, skeptical review."
enforcement: gating
phase: build
standalone: true
requires: [verify-claims]
model: opus
---

## Purpose

Implements the generator/evaluator separation pattern. The evaluator gets a fresh context reset
(no shared state with the generator) and is prompted for calibrated skepticism — finding real
issues, not rubber-stamping work.

**Correctness gate:** a review finding is a claim, and a false-confident one either blocks good
work or waves through a bug. Per the `/verify-claims` protocol, the evaluator attaches a grounded
confidence % and its basis to each finding (`verified` — reproduced/traced in the code — vs
`inferred`), never asserts a defect it has not verified, and flags a low-confidence finding as
**tentative** rather than as a hard defect.

### Provider-native delegation

Dispatch the evaluator through the selected host's available subagent facility. Preserve the fresh
context boundary, skeptical review, verdict output, and blocking gates regardless of host.
**Claude delegation:** Claude uses the Agent tool; the Claude model choices below apply only to
that facility. A Codex-selected run uses its available subagent facility and configured Codex
provider policy, without translating Claude model names.

## Practices

### 1. Prepare Review Context

Gather what the evaluator needs:
- Git diff of changes — **for batch reviews, scope to the current batch only** (commits since
  last batch boundary via `git diff <batch-start-commit>..HEAD`), not the full branch diff.
  For the final batch, add a lightweight integration check (full branch diff stat summary) but
  do NOT re-review earlier batches line by line — they already passed their own evaluator gate.
- The story/acceptance criteria being implemented (from `.docs/stories/`)
- The implementation plan task (from `.docs/plans/`)
- The relevant affected-test result set
- Tech-context review checklist if loaded in session
- A focused **current-HEAD pattern basis**, when the task supplies one: current-checkout paths
  for the relevant target and exemplar, stable symbol or role hints, the semantic traits to
  preserve or change, and allowed variation. It complements the task criteria and affected-test
  results; it does not expand review context to the full plan, unrelated stories, or history.

For batch reviews, use the provided `BATCH_AFFECTED_TESTS` result set; require a full-suite result only when the batch scope was indeterminate.

### 2. Dispatch Evaluator Agent

Use `agents/evaluator.md` with the selected host's subagent facility. The evaluator runs in a **fresh context**
— it does not share conversation history with the generator.

**Claude model selection by batch content:**
- **Claude Code Sonnet** (`model="sonnet"`) — batches containing only: value objects, pure functions,
  configuration files, infrastructure setup, or view templates
- **Claude Code Opus** (`model="opus"`) — batches with: concurrency, state mutation, security boundaries,
  financial calculations, auth logic, or complex domain interactions

Provide the evaluator with:
- The diff
- The spec (story + acceptance criteria)
- The test output
- The review checklist (generic + tech-context from session if available)
- **Impacted test file paths** — for batch reviews, the provided `BATCH_AFFECTED_TESTS` union;
  otherwise, spec files changed in the diff plus specs corresponding to changed source files.
  The evaluator will run these before reviewing.
- The focused **current-HEAD pattern basis**, when present alongside the task criteria and affected
  tests. Read the named files at current HEAD; paths and symbols are locating aids, not frozen
  coordinates or source text. If an exemplar moved, locate and verify its semantic equivalent. If
  no current equivalent can be verified and that uncertainty makes conformance indeterminate,
  request the specific context needed rather than guessing or blocking on stale coordinates.

### 3. Three-Stage Review

The evaluator runs three stages in order. Failures in earlier stages block later stages.

#### Stage 1: Spec Compliance
- Does the code implement what the story asks for?
- Are ALL acceptance criteria met (happy AND negative paths)?
- Is anything implemented that wasn't asked for?
- For each criterion, is there sufficient behavioral coverage at the lowest suitable layer? Map it
  to the affected-test evidence, an existing sufficient test, or a focused new test, and confirm
  that its assertions actually prove the behavior. Compatible criteria may share coverage; do not
  require one corresponding new test per criterion.

#### Stage 2: Code Quality
- Is the code clear and readable?
- Are names intention-revealing?
- Is there unnecessary complexity?
- Are there duplicated patterns that should be extracted?
- Does error handling follow consistent patterns?
- If tech-context loaded: stack-specific checks (N+1, security, performance)
- When a pattern basis is present, flag only a concrete, material departure from its relevant
  semantic traits that creates a correctness, security, or meaningful maintenance risk. Accept
  documented allowed variation and immaterial implementation differences. Do not block solely for
  the reviewer's preferred abstraction or naming, exact textual copying, or stale file/line
  coordinates.

#### Stage 3: Domain Integrity
- Are domain types used appropriately?
- Are boundaries respected?
- Is domain language used in naming?
- Could invalid states be represented?

### 4. Evaluator Calibration

The evaluator is prompted to be **genuinely critical, not performative**:

- Find real issues that would cause bugs, maintenance problems, or security vulnerabilities
- Don't nitpick style preferences that don't affect correctness
- Don't flag things that are intentional trade-offs documented in the plan
- Do flag things that seem intentional but are actually wrong
- Verify claims by running tests, not by trusting the generator's report
- Treat pattern conformance as semantic judgment: explain the applicable trait, the observed
  departure, and the material consequence. If the supplied basis cannot be connected to a current
  equivalent, request context; do not infer an exact-copy requirement or manufacture a blocking
  finding from an immaterial difference.

### 5. Review Verdict

The evaluator produces a structured verdict:

```markdown
## Review: [Feature/Task Name]

### Stage 1: Spec Compliance
**Verdict:** PASS | FAIL
- [Finding with file:line reference]

### Stage 2: Code Quality
**Verdict:** PASS | FAIL
- [Finding with file:line reference]

### Stage 3: Domain Integrity
**Verdict:** PASS | FAIL
- [Finding with file:line reference]

### Summary
**Overall:** APPROVE | REQUEST_CHANGES | BLOCK
**Critical issues:** [Count — must fix before merge]
**Important issues:** [Count — should fix before merge]
**Minor issues:** [Count — fix when convenient]
```

### 6. Act on Findings

| Severity | Action |
|----------|--------|
| Critical | Fix immediately. Re-run review after fix. |
| Important | Fix before proceeding to next task. |
| Minor | Note for future. Don't block progress. |

**GATE: BLOCK verdict prevents merge. REQUEST_CHANGES must be addressed before re-review.**

### Memory Checkpoint

After acting on evaluator findings, persist:
- **Category: `patterns/`** — If the evaluator identified a recurring quality pattern (positive or negative) that should inform future TDD cycles
- **Category: `gotchas/`** — If the evaluator found a subtle issue that the generator/domain-reviewer missed

Skip if: all findings were standard quality issues (naming, complexity) with no cross-session value.

## Verification

- [ ] Evaluator dispatched with fresh context (no shared state with generator)
- [ ] All three stages reviewed in order
- [ ] Spec compliance checked against ALL acceptance criteria (happy + negative)
- [ ] Each acceptance criterion has sufficient behavioral coverage evidence; no one-test-per-
  criterion rule was imposed
- [ ] Focused current-HEAD pattern basis applied when present; indeterminate conformance requested
  context rather than relying on stale coordinates
- [ ] Tech-context review checklist applied if available
- [ ] Findings include file:line references
- [ ] Critical/Important issues addressed before proceeding
- [ ] Re-review ran after fixing critical issues
- [ ] Evaluator ran impacted tests and reported results
- [ ] Recurring patterns or missed-by-TDD issues persisted to `.memory/` (if applicable)
