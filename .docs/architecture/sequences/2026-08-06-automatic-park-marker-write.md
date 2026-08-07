# Sequence: Automatic park marker write

**Last updated:** 2026-08-06
**Scope:** The setup-failure termination flow through the daemon error boundary, before and after
the honest-park change. Covers intake `jstoup111/ai-conductor#1328`.

## Today — the infinite re-dispatch loop

```mermaid
sequenceDiagram
    participant B as daemon-backlog
    participant R as daemon-runner
    participant P as prepareWorktree / bin-setup
    participant T as setup-triage
    participant H as .pipeline/HALT (worktree)
    participant M as .daemon/parked (main root)
    participant C as park-reconciliation

    B->>B: Scan eligibility, check isOperatorParked
    M-->>B: No marker for «slug»
    B->>R: Dispatch «slug» — listed ELIGIBLE
    R->>P: prepareWorktree
    P-->>R: SetupFailureError
    R->>T: runSetupTriage — spends a fix-session
    T-->>R: TriageOutcome kind park
    R->>R: Log "triage outcome: park, erroring feature"
    R->>H: writeErrorHalt — "parked for human inspection"
    Note over R,M: No call is ever made to the marker writer
    R-->>B: status error, worktree kept
    C->>M: Sweep parked markers
    M-->>C: none
    C->>C: Log parked=0
    B->>B: Next scan, check isOperatorParked
    M-->>B: Still no marker
    B->>R: Dispatch «slug» again — loop repeats
```

Each turn of this loop spends a whole fix-session on the same unresolved wall. The HALT the
operator reads asserts the feature was parked, so the state that would stop the loop looks like it
already exists.

## After — park intent settles durable state before the note is written

```mermaid
sequenceDiagram
    participant B as daemon-backlog
    participant R as daemon-runner
    participant P as prepareWorktree / bin-setup
    participant T as setup-triage
    participant X as terminateFeature (new primitive)
    participant M as .daemon/parked (main root)
    participant H as .pipeline/HALT (worktree)
    participant C as park-reconciliation

    B->>R: Dispatch «slug»
    R->>P: prepareWorktree
    P-->>R: SetupFailureError
    R->>T: runSetupTriage
    T-->>R: TriageOutcome kind park
    R->>X: Terminate with park intent true and reason
    X->>M: writeAutoPark — resolves main root, idempotent
    M-->>X: Marker written for «slug»
    X->>H: Render note FROM the write result — "parked, will not re-dispatch"
    X-->>R: Termination result
    R-->>B: status error, worktree kept
    C->>M: Sweep parked markers
    M-->>C: Marker for «slug»
    C->>C: Log parked=1
    B->>B: Next scan, check isOperatorParked
    M-->>B: Marker present
    B->>B: Skip «slug» — not dispatchable
```

## After — a non-park error still re-dispatches

```mermaid
sequenceDiagram
    participant B as daemon-backlog
    participant R as daemon-runner
    participant X as terminateFeature (new primitive)
    participant M as .daemon/parked (main root)
    participant H as .pipeline/HALT (worktree)

    B->>R: Dispatch «slug»
    R->>R: Loop ends without DONE or HALT — site :536
    R->>X: Terminate with park intent false and reason
    Note over X,M: No marker is written
    X->>H: Render note — "errored, will re-dispatch on the next scan"
    X-->>R: Termination result
    R-->>B: status error
    B->>B: Next scan, check isOperatorParked
    M-->>B: No marker
    B->>R: Dispatch «slug» again — intended retry, unchanged
```

## After — the marker write fails

```mermaid
sequenceDiagram
    participant R as daemon-runner
    participant X as terminateFeature (new primitive)
    participant M as .daemon/parked (main root)
    participant H as .pipeline/HALT (worktree)

    R->>X: Terminate with park intent true
    X->>M: writeAutoPark
    M-->>X: Write error — not EEXIST
    X->>H: Render note — park FAILED, names the error, tells the operator to park by hand
    Note over X,H: The note never asserts a park that did not happen
    X-->>R: Termination result carrying the park failure
```

## Legend

- `«slug»` is the feature slug placeholder.
- `.pipeline/HALT` is worktree-local and disposable; `.daemon/parked/«slug»` is main-root and
  durable. Only the latter is consulted by `daemon-backlog` eligibility.
- "Render note FROM the write result" is the ordering constraint that makes the HALT's claim
  structurally true rather than prose the caller is trusted to keep in sync.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-06 | Initial generation | Spec for intake #1328 — automatic park writes no marker |
