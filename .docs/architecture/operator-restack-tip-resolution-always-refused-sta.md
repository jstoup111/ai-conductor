# Sequences: Stacked restack recovery and stacked halt records

**Last updated:** 2026-11-02
**Scope:** Resolver tip authority, recorded-resolution consumption, stale resolutions, and where a stacked feature's halt record lives. Source: #3582, folding #3557 and #3576.

## Diagram: a provider-settled restack keeps every candidate commit

```mermaid
sequenceDiagram
    participant Exec as restack executor or recovery
    participant Res as resolveRestackConflict
    participant Step as StepRunner resolver
    participant Prov as provider session
    participant Git as temporary detached worktree

    Exec->>Res: range, newParent, journal stamp
    Res->>Git: rebase -i with hook, identity and attributes env
    Git-->>Res: paused on conflict
    Res->>Step: context with environment
    Step->>Prov: invocation with environment overlay
    Prov->>Git: resolve, then rebase --continue in that env
    Git-->>Res: post-rewrite list written
    Res->>Res: tip = last rewrite
    alt a candidate subject is missing from newParent..tip
        Res-->>Exec: conflict_halt, feature commits lost
        Exec->>Exec: abort journal, fresh conflict record, halt
    else every candidate is present
        Res-->>Exec: settled tip
    end
```

## Diagram: consuming or retiring a recorded resolution

```mermaid
sequenceDiagram
    participant Op as operator
    participant CLI as stack restack-resolve
    participant Refs as refs/conductor/«slug»/restack
    participant Exec as restack executor or recovery

    Op->>CLI: --tip «sha» or --decision «answer»
    CLI->>Refs: record the answer, then clear the halt
    Exec->>Refs: read resolution and conflict record
    alt no record for this child
        Exec->>Refs: retire the orphan resolution
        Exec->>Exec: ordinary replay
    else range and parent match after masking the feature's own halt record
        Exec->>Exec: replay the tip onto the live parent, carrying the newest halt record
        Exec->>Refs: delete answer and record when the restack applies
    else real content changed
        Exec->>Refs: retire the resolution, write a fresh record against the live parent
        Exec-->>Op: restack-resolution-stale halt with Restack-Conflict line and both recipes
    end
```

## Diagram: where a halt record goes

```mermaid
sequenceDiagram
    participant Seam as writeHaltMarker or supersede
    participant Cursor as hasDurableChildState
    participant Ref as refs/conductor/«slug»/halt-record
    participant Branch as feature branch
    participant Move as moveLeaf

    Seam->>Cursor: is this feature in the stacked-child lifecycle?
    alt stacked
        Seam->>Ref: append a commit holding the record, compare-and-swap
        Note over Branch: no stack branch gains a commit
    else not stacked, including a leaf before stacking
        Seam->>Branch: commit and push, as today
    end
    Move->>Branch: list leaf commits outside the tip and the default branch
    alt only this feature's halt-record commits
        Move->>Branch: advance the leaf
    else any other commit
        Move-->>Seam: refuse, naming the commit
    end
```

## Legend

`«slug»` is the feature slug. "Masking" means comparing trees with only `.docs/halted/«slug».md` removed.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-02 | Initial generation | #3582 DECIDE |
