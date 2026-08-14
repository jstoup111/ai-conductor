# Sequence: independent build_review grading and exact-lap disposition

**Last updated:** 2026-08-13
**Scope:** One failed `build_review` lap, one concurrent operator acceptance, and a later lap where
only the same accepted concern is non-blocking. Issue #1542.

## Diagram

```mermaid
sequenceDiagram
  actor O as Feature operator
  participant C as Conductor
  participant S as Snapshot assembler
  participant P as Tautology preflight
  participant K as Evidence and rubric cache
  participant G as Group core
  participant R as Rubric sessions
  participant J as Single-writer join
  participant D as Disposition store
  participant E as Event spine
  participant CLI as Operator CLI

  C->>C: resolve config and reject enabled plus zero rubrics
  C->>S: validate current test_suite PASS and assemble lap «L1» once
  S-->>C: immutable base, HEAD, diff, plan, green proof, derived evidence
  C->>K: check exact Tautology preflight input
  K-->>C: cold preflight miss
  C->>P: keep changed tests and substitute merge-base production in isolated checkout
  P-->>C: typed RED result or infrastructure failure
  P->>K: cache completed semantic preflight evidence only
  C->>C: derive closed versioned projection per rubric
  C->>G: eligible rubrics plus max parallel 5
  par one detached session per eligible rubric
    G->>K: Tautology projection plus policy fingerprint
    K-->>R: cache miss, Tautology skill plus projection
    G->>K: Scope projection plus policy fingerprint
    K-->>R: cache miss, Scope skill plus projection
    G->>K: Root Cause projection plus policy fingerprint
    K-->>R: cache miss, Root Cause skill plus projection
    G->>K: Completeness projection plus policy fingerprint
    K-->>R: cache miss, Completeness skill plus projection
    G->>K: Wiring projection plus policy fingerprint
    K-->>R: cache miss, Wiring skill plus projection
  end
  Note over G,R: each branch uses its own provider, model, effort,<br/>fallback, retry, and escalation policy
  R-->>J: write-disjoint structured rubric results
  R->>K: store validated semantic judged results only
  J->>J: validate all enabled results and canonicalize finding IDs
  J->>D: read accepted IDs under state lock
  D-->>J: no matching disposition
  J->>J: raw FAIL equals effective FAIL
  J->>E: rubric outcomes plus effective outer FAIL
  J-->>C: publish current verdict for lap L1
  C->>C: normal build_review failure routing remains blocking

  O->>CLI: inspect feature
  CLI->>J: read current verdict
  J-->>CLI: lap L1 plus unresolved finding F1
  O->>CLI: accept L1 and F1 with rationale
  CLI->>CLI: require interactive TTY and resolve machine identity
  CLI->>D: acquire shared lock
  CLI->>J: compare current lap and finding under lock
  alt current lap is still L1 and F1 is unresolved
    CLI->>D: atomic write disposition for F1
    CLI->>E: append disposition-accepted ConductorEvent<br/>to existing external-process ledger
    CLI-->>O: accepted with operator attribution
  else lap or finding changed
    CLI->>E: append disposition-refused ConductorEvent<br/>to existing external-process ledger with no state mutation
    CLI-->>O: stale or mismatched request refused
  end

  C->>S: assemble later lap «L2»
  C->>K: exact preflight key unchanged
  K-->>C: reuse typed RED preflight evidence
  C->>G: evaluate enabled rubric cache keys
  G->>K: unchanged projections, contracts, and execution policies
  K-->>J: stamp cached semantic results into fresh L2 branch artifacts
  K->>E: emit rubric cache-hit events
  Note over G,R: no rubric provider call is made for a valid cache hit
  J->>J: same concern retains stable canonical anchors
  J->>J: canonical ID remains F1
  J->>D: match F1 to accepted disposition
  D-->>J: accepted by operator with rationale and time
  J->>J: mark F1 accepted after raw grading
  alt every other enabled result passes
    J->>E: raw rubric FAIL plus effective outer PASS
    J-->>C: build_review PASS
  else another finding or infrastructure failure exists
    J->>E: effective outer FAIL with unresolved IDs
    J-->>C: build_review remains blocking
  end
```

## Invariants

> **Amended 2026-08-13 by #1542 architecture review:** operator events reuse the existing
> `.pipeline/pipeline-events.jsonl` same-schema external-process ledger. No operator-specific event
> file is introduced.

- The outer gate cannot pass before all enabled branches settle and the deterministic join validates
  their results. A missing, malformed, permission-denied, or provider-exhausted branch is an
  infrastructure failure, never a skip or pass.
- A disabled rubric never dispatches and emits `skipped: disabled`. Wiring also emits
  `skipped: missing-entry-points` without dispatch when its production-entry premise is absent.
  Both are excluded from pass/fail denominators and included in coverage reporting; neither is a
  pass.
- The operator acts on an inspected lap ID. Join publication and disposition mutation share one
  lock, so the CLI either accepts the exact current finding or refuses without mutation.
- Acceptance is applied after raw grading. It suppresses only the matching concern's blocking
  effect; it does not suppress execution, alter the grader prompt, or hide new findings.
- `test_suite` supplies current-HEAD green proof once. Tautology's additional test evidence is the
  isolated reverted-production RED experiment; neither live checkout is mutated.
- A cache hit requires unchanged versioned permitted inputs and execution policy. It creates new
  current-lap branch evidence before join; infrastructure failures never cache and an old aggregate
  verdict never satisfies freshness.
- PR and shipped-record rendering reads the same disposition state used by the join and presents
  accepted risk as evidence, never as a grader pass.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-13 | Added exact-input preflight cache before rubric projection | Post-plan architecture-diagram/review pass |
| 2026-08-13 | Added Tautology RED preflight and cache-hit path | Avoid redundant green tests and repeat rubric model calls |
| 2026-08-13 | Reused the existing external-process event ledger | Architecture review reuse check |
| 2026-08-13 | Initial proposed sequence | DECIDE phase for issue #1542 |
