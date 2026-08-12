# Sequence: a non-converging build_review reaches a bounded terminal state

**Last updated:** 2026-08-12
**Scope:** One `build_review` FAIL lap, showing where the cumulative bound is consumed and where
removal evidence reaches the grader. Issue #1521.

## Diagram

```mermaid
sequenceDiagram
  participant C as Conductor (build_review)
  participant D as Removal-evidence deriver
  participant P as buildGraderPrompt
  participant G as Grader session (LLM)
  participant L as kickback-ledger.json
  participant E as events.jsonl

  C->>D: derive removals from base...HEAD diff
  D-->>C: deleted files + deleted exported symbols
  C->>P: BuildReviewInputs (diff, plan, repair, widenings, removalContext)
  P->>G: grader prompt with narrowed Tautology clause
  Note over G: a changed test whose subject was deleted<br/>in this diff is removal maintenance —<br/>a test claiming new behavior stays mutation-sensitive
  G-->>C: .pipeline/build-review.json verdict

  alt verdict PASS
    C->>L: clear both counters for this gate
    C->>E: step verdict — feature advances
  else verdict FAIL
    C->>L: consumeKickbackBudget(build_review, reasons)
    L-->>C: count (per-tree), cumulative (per-feature), exhausted flags
    alt cumulative over cap
      C->>E: loop_halt — gate, cumulative lap count, last reason
      Note over C: writeHaltMarker(needs-human)<br/>the re-kick sweep will not recycle it
    else per-tree count exhausted
      C->>E: loop_halt — existing MAX_KICKBACKS_PER_GATE path, unchanged
    else budget remains
      C->>E: kickback — count plus cumulativeCount
      C->>C: navigateBack to build or remediate
    end
  end
```

## Legend

- **Two independent bounds.** `count` is keyed on the HEAD tree hash and is reset by any real
  edit — that behavior is unchanged from `adr-2026-07-26`. `cumulative` counts every lap for the
  gate regardless of tree movement, and is cleared only by a PASS. The incident escaped the first
  bound precisely because every remediation lap changed the tree; the second bound closes it.
- **`cumulativeCount` on the `kickback` event** is what makes the history readable. Today an
  operator reading `events.jsonl` sees eight rows all reporting `count 1`, which looks like eight
  unrelated first offences rather than one feature failing to converge.
- The removal-evidence step runs **before** prompt assembly and is purely deterministic — no LLM
  is in the exemption decision path, only in applying it to specific test hunks.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-12 | Initial generation | Issue #1521 |
