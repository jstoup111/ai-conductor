# Protected SHIP validation and stale verdict recovery

**Last updated:** 2026-11-19  
**Scope:** Proposed dispatch and verdict handling for manual_test, prd_audit and architecture_review_as_built in #3685.

```mermaid
sequenceDiagram
    participant E as Conductor
    participant V as Validator process
    participant P as Product worktree and Git state
    participant A as Validator evidence under .pipeline/
    participant B as BUILD and review gates
    alt Protection available
        E->>V: Dispatch with protected product and Git paths
    else Protection unavailable or unproven
        E->>E: Publish prominent warning with validator and reason
        E->>V: Run in dispatch-owned checkout without waiting for approval
    end
    V->>P: Inspect product code
    Note over V,P: Protected runs prevent product edits and Git mutations
    V->>A: Write owned findings and evidence
    V-->>E: Return validation outcome
    E->>A: Read verdict and checked revision
    E->>E: Check each verdict against current code before routing
    alt Product changes require BUILD verification
        E->>E: Capture and verify fallback changes before cleanup
        E->>B: Deliver recoverable changes to owning BUILD task
        B->>B: Verify and review repaired code before SHIP
    else Code change made a verdict stale
        E->>V: Redispatch affected validator against current revision
        Note over E,V: Each retry follows the same protection and freshness checks
    else Current evidence identifies a product defect
        E->>B: Route finding through its existing repair path
        B->>B: Repair product code and run test_suite and build_review
    else All required verdicts are current and satisfied
        E->>E: Advance SHIP
    end
```

The validator lane represents one member, whether dispatched alone or alongside siblings. The conductor owns the parallel join. Each validator needs a writable location for its own evidence. A code change made outside the validator can invalidate a result even when the validator itself obeyed its write restrictions.

The existing gate-code-validity logic distinguishes verdicts that can be preserved from those that require a rerun. The proposed join uses that distinction before consuming findings. Both dispatch modes bind evidence to the revision inspected. The unprotected path must also account for uncommitted product edits before trusting the results.

## Change log

2026-11-19 — Added the proposed validation flow for #3685.
