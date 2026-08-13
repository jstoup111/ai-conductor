# Sequence: Base-advance repair reaches the build_review grader

**Last updated:** 2026-08-13
**Scope:** The observed failing sequence (intake #1535) and the sequence after the change.
Covers one build lap from base advance through `build_review` grading.

## Diagram: today — attribution is lost

```mermaid
sequenceDiagram
  autonumber
  participant R as rebase.ts
  participant V as gates/«step».json
  participant B as build step
  participant T as test_suite
  participant M as test-suite-remediation.ts
  participant L as repair ledger
  participant G as build_review grader

  Note over R,V: base advance deletes agents/planner.md on main
  R->>V: applyRebaseVerdicts writes kickback from rebase<br/>to build, test_suite, build_review
  R->>B: navigateStateBack re-opens the gates
  B->>B: build re-runs and a branch test still reads<br/>the deleted file
  B->>V: computeAndWriteVerdict rebuilds the verdict<br/>and the kickback is ERASED
  T->>T: full suite FAILS with ENOENT on the deleted file
  T->>M: recordTestSuiteRebaseRepair called with the failure
  M->>V: readVerdict for build_review
  V-->>M: kickback absent or from build_review
  M-->>L: wasInvalidatedByRebase false — returns early<br/>and the ledger is never written
  B->>B: build deletes the stale test, which is correct repair
  G->>L: assembleBuildReviewInputs reads repairContext
  L-->>G: empty
  G-->>B: FAIL on Tautology and Scope — no recorded<br/>rebase-repair context authorizes the exception
  Note over G,B: remediate cannot clear it and the next lap repeats
```

## Diagram: after the change — attribution is durable

```mermaid
sequenceDiagram
  autonumber
  participant R as rebase.ts
  participant E as events.jsonl
  participant B as build step
  participant T as test_suite
  participant M as test-suite-remediation.ts
  participant L as repair ledger
  participant G as build_review grader

  R->>E: emits rebase_changed with changedPaths<br/>and rebase_gate_invalidated with matchedPaths
  Note over R,E: append-only, per-feature, survives every gate re-run
  R->>B: gates re-opened exactly as today
  T->>T: full suite FAILS with ENOENT on the deleted file
  T->>M: recordGateRepair called with gate test_suite<br/>and the failure
  M->>E: resolveBaseAdvance reads advances since<br/>the last graded lap
  E-->>M: rebase_changed carrying agents/planner.md
  M->>M: join — the failure diagnostic overlaps a changed<br/>path AND falls in the advance window
  M->>L: append a repair keyed on advance plus failure,<br/>so N repairs per advance accrue
  B->>B: build deletes the stale test, which is correct repair
  G->>L: assembleBuildReviewInputs reads repairContext
  L-->>G: one repair record naming the ENOENT diagnostic
  G-->>B: PASS — the deletion is judged against<br/>recorded repair context
  G->>E: emits grading provenance — repair context<br/>available, or empty and why
  Note over G,E: an operator can now tell from run artifacts<br/>which case a finding was graded under
```

## Legend

- **`«slug»`** — a variable path segment (feature slug, step name).
- **events.jsonl** — `«worktree»/.pipeline/events.jsonl`, the per-feature event spine written
  by `EventPersister` into the feature's worktree. Append-only, so nothing overwrites a prior
  advance.
- **gates/«step».json** — `«worktree»/.pipeline/gates/«step».json`, a gate verdict file.
  Rewritten in full by `computeAndWriteVerdict` on every gate run, which is why it cannot carry
  a fact that must outlive one pass.
- **repair ledger** — `«worktree»/.pipeline/build-review-rebase-repairs.json`.
- **join** — an advance is matched to a failure only when the failure's diagnostic implicates a
  path the advance changed *and* the failure occurred after the advance. Path overlap is
  required. A time window alone would launder genuinely unplanned deletions.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-13 | Initial generation | DECIDE for intake #1535 — document the lost-attribution chain and its replacement |
