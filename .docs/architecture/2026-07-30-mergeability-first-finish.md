# Architecture: Mergeability-first daemon finish

**Last updated:** 2026-07-30
**Scope:** Finish-time mergeability skipping and preserved re-kick play-forward behavior.

## Component view

```mermaid
flowchart LR
    Finish["Finish-time gate"]
    Rekick["Re-kick resume"]

    subgraph FinishPolicy["Finish-only mergeability policy"]
        Guard["Pre-existing rebase-state guard"]
        Base["Resolved default or base target"]
        MergeCheck["Prospective mergeability check"]
        Outcome["Structured integration outcome"]
    end

    subgraph Existing["Existing recovery machinery"]
        Rebase["Rebase driver"]
        Resolver["Bounded conflict resolver"]
        Halt["Mechanical HALT"]
    end

    Continue["Continue without history rewrite"]
    Verify["Downstream gate handling"]

    Finish --> Guard
    Rekick --> Rebase
    Guard --> Base
    Base --> MergeCheck
    MergeCheck -->|"clean"| Continue
    MergeCheck -->|"conflict or indeterminate"| Rebase
    Rebase -->|"clean"| Outcome
    Rebase -->|"conflict"| Resolver
    Resolver -->|"resolved"| Outcome
    Resolver -->|"exhausted or unsafe"| Halt
    Continue --> Outcome
    Outcome --> Verify
```

## Sequence: entry-specific integration policy

```mermaid
sequenceDiagram
    participant E as Integration entry
    participant G as Git adapter
    participant P as Shared integration policy
    participant R as Existing rebase recovery
    participant V as Gate and event recorder

    E->>P: integrate feature with resolved target

    alt normal finish
        P->>G: verify no rebase is already active
        G-->>P: safe to assess
        P->>G: evaluate prospective merge without mutation
        alt prospective merge is clean
            G-->>P: mergeable
            P-->>V: mergeable skip
            Note over P,V: Preserve feature history and downstream verdicts
        else conflict or indeterminate
            G-->>P: recovery required
            P->>R: run automatic rebase and bounded resolution
            R-->>V: rebased or conflict HALT
        end
    else re-kick resume
        P->>R: mandatory play-forward rebase
        Note over P,R: Incorporate advanced-base commits before retrying the pending gate
        R-->>V: rebased or conflict HALT
    end
```

## Architectural notes

- Finish owns the prospective-merge decision because publication readiness is its goal.
- The finish caller enables that policy explicitly when it calls the shared rebase primitive; the
  primitive's default remains mandatory rebase so other callers cannot inherit the skip by omission.
- Re-kick bypasses mergeability skipping because it must incorporate advanced-base commits before
  retrying a previously halted gate.
- The prospective mergeability check is read-only. It cannot update the branch, index, worktree,
  protected-artifact seal, or evidence citations.
- A clean result is a new semantic outcome: the feature is mergeable but may not be current with the
  target branch.
- Conflict and indeterminate results reuse the existing rebase and bounded resolver path.
- Existing detection of an active or paused rebase runs first and retains its fail-closed behavior.

## Legend

- **Finish-time gate:** uses the deterministic mergeability-first decision introduced here.
- **Re-kick resume:** retains mandatory play-forward rebase under its existing contract.
- **Existing recovery machinery:** current rebase, resolver, and HALT behavior retained unchanged
  except for when it is entered.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-30 | Initial architecture | Describe mergeability-first finish and re-kick behavior |
| 2026-07-30 | Plan update: explicit caller policy | Keep mergeability skipping finish-only while preserving the shared recovery primitive |
