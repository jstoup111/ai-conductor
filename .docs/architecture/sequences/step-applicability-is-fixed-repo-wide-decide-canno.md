# Sequence: per-feature inapplicable step, declare → merge → dispatch

**Last updated:** 2026-10-03
**Scope:** One feature in a repository with the per-feature applicability toggle on, from DECIDE
declaring a step inapplicable to the daemon dispatching past it, plus the branch-only and late
declaration refusal paths.

## Diagram

```mermaid
sequenceDiagram
    actor Author as DECIDE author
    participant Land as Land gate
    actor Op as Operator
    participant Base as Base branch
    participant Backlog as Daemon backlog
    participant Disp as Dispatch loop
    participant Spine as Event spine

    Author->>Land: land spec with applicability marker for «stem»
    Land->>Land: validate toggle, step known and declarable, reason, duplicates
    alt invalid declaration
        Land-->>Author: landGateError naming the row
    else valid
        Land-->>Op: spec PR opened
        Op->>Base: review and merge spec PR
        Backlog->>Base: read tier, track, applicability markers from base tree
        Backlog->>Base: resolve decider from commit that introduced the marker
        Backlog->>Disp: dispatch feature with inapplicable steps, reason, decider
        loop each step in order
            alt step declared inapplicable and not yet started
                Disp->>Disp: record skip with inapplicable cause
                Disp->>Spine: step_inapplicable (step, reason, decider)
            else declared after the step started
                Disp->>Spine: applicability refused (step, prior outcome stands)
            else not declared
                Disp->>Disp: run step normally
            end
        end
    end
    Note over Disp,Spine: A marker present only on the feature branch is ignored and reported, never honored
```

## Legend

- `«stem»` is the feature's plan stem.
- Event names are proposals; architecture-review fixes the final schema on the existing
  ConductorEvent union.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial generation | #1789 per-feature step applicability DECIDE |
