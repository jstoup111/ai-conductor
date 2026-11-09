# Architecture: A retryable HALT is cleared before the daemon re-dispatches it (#3601)

**Last updated:** 2026-11-07
**Scope:** How the daemon core re-dispatches a parked feature whose `.pipeline/HALT` is retryable (class `mechanical` or `legacy`). Before this change, the progress-gated re-kick re-dispatched such a feature with its HALT still live. On a stacked feature, the stack preflight refused every one of those dispatches ("live HALT without resume authorization"). The refused dispatch did not move the progress baseline, so the feature stayed eligible and looped until the per-run dispatch ceiling (20). After this change, the daemon core's dispatch boundary owns three things: clearing the retryable HALT, granting one prompt re-dispatch per distinct retryable HALT, and stamping the progress baseline. The stack preflight's live-HALT guard and needs-human retention do not change. The dispatch boundary runs in the parent daemon process, ahead of whichever `FeatureExecutor` runs the feature, so it does not depend on [one daemon feature lifecycle](daemon-still-carries-two-feature-executors-in-proc.md).

## Components (L3)

```mermaid
graph TD
    subgraph Core["engine/daemon.ts runDaemon (parent process)"]
        Pick["pickEligible<br/>parked + live HALT branch"]
        Fresh["isFreshRetryableHalt dep<br/>class mechanical or legacy AND<br/>HALT body differs from HALT.rekicked"]
        Prog["isProgressReKickEligibleBounded<br/>(ceiling 20, unchanged)"]
        Disp["dispatch boundary<br/>clearRetryableHalt + stampDispatchBaseline<br/>then executor.execute"]
    end

    subgraph Rekick["engine/daemon-rekick.ts"]
        Ret["resolveHaltRetention<br/>needs-human / unclassified retained"]
        Clear["clearRetryableHaltMarker<br/>HALT body to HALT.rekicked, rm HALT + HALT.class,<br/>write REKICK; HALT.cleared untouched"]
        Sweep["clearMarker (sweeps only, unchanged)<br/>HALT to HALT.cleared"]
    end

    subgraph Evidence["engine/task-evidence.ts + task-progress.ts"]
        Base["TaskEvidence.lastResolvedCount<br/>whole-feature scope,<br/>stamped at dispatch start"]
        Count["countResolvedTasks(root)<br/>no child scope"]
    end

    subgraph Exec["FeatureExecutor (child process)"]
        Pre["runStackPreflight<br/>live-HALT guard unchanged"]
        Cond["Conductor.run<br/>build-exit baseline stamps removed"]
    end

    Spine["halt-clear append seam<br/>appendHaltClearedRecord cause rekick:<br/>audit-trail halt_cleared + record supersede"]
    Sweeps["base-advance rekickSweep +<br/>episode-end sweep (unchanged)"]

    Pick --> Fresh
    Pick --> Prog
    Fresh --> Ret
    Prog --> Ret
    Prog --> Base
    Prog --> Count
    Pick -->|"eligible slug"| Disp
    Disp --> Clear
    Disp --> Base
    Disp --> Count
    Disp -->|"after clear"| Spine
    Disp -->|"execute, no live retryable HALT"| Exec
    Pre --> Cond
    Sweeps --> Sweep
    Carrier["HALT.cleared<br/>over-scope decision carrier,<br/>harvested at prd_audit entry"]
    Cond -.->|"prd_audit harvests"| Carrier
```

## Sequence: a mechanical HALT on a stacked feature

```mermaid
sequenceDiagram
    participant C as Conductor (dispatch k)
    participant D as daemon.ts dispatch boundary
    participant P as pickEligible
    participant R as daemon-rekick clearRetryableHaltMarker
    participant S as runStackPreflight
    C->>C: gate blocked, reachable pending prerequisite
    C->>C: write HALT + HALT.class mechanical
    C-->>D: outcome halted, slug parked
    P->>P: HALT body differs from HALT.rekicked
    P-->>D: eligible (one prompt re-dispatch)
    D->>R: clearRetryableHalt(slug)
    R->>R: body to HALT.rekicked, HALT removed, REKICK written
    D->>D: append halt_cleared cause rekick, supersede halt record
    D->>D: stamp lastResolvedCount (whole feature)
    D->>S: execute dispatch k+1
    S->>S: no live HALT, base refresh via REKICK
    S-->>C: resume clamps to test_suite
    Note over P,D: Same HALT body again, so it equals HALT.rekicked and is not<br/>promptly eligible. It waits for a base advance or episode-end sweep.<br/>A dispatch that resolves no task leaves live count equal to its<br/>start stamp, so the progress re-kick is not eligible either.
```

## Legend

- **Retryable HALT:** `HALT.class` resolves to `mechanical` or `legacy` through `resolveHaltRetention`. `needs-human`, `unclassified`, and unknown classes are retained. No automatic path in this design clears or re-dispatches them.
- **Distinct HALT:** compared by the bytes of the live HALT body against `.pipeline/HALT.rekicked`, the body the dispatch boundary last cleared. That is per-worktree durable state, read by name (event-spine exception C).
- **`HALT.cleared` is never touched by the dispatch boundary.** It is also the prd_audit over-scope decision carrier (`adr-2026-08-24-over-scope-decision-block-and-durable-refusals`), so overwriting it before prd_audit harvests it would destroy an operator's decision. The sweeps still use `clearMarker`, unchanged; #3551 tracks that file's semantics.
- **Progress baseline:** `TaskEvidence.lastResolvedCount`. Its only reader is the progress-gated re-kick. After this change, the dispatch boundary is its only writer, at whole-feature scope.
- **Unchanged:** the stack preflight's live-HALT guard and its resume-authorization path, the base-advance sweep's once-per-SHA bound, the episode-end sweep, the operator park, and the progress re-kick ceiling.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-07 | Initial | #3601 resume-and-refuse loop on mechanical HALTs |
