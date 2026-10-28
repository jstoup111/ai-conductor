# Components: Halt-record bookkeeping in stacked restack replay

**Last updated:** 2026-10-28
**Scope:** How a stacked restack replays a child range that carries halt-record commits
(`.docs/halted/«slug».md`), on both replay paths, before and after this change (intake #3451).
Halt records are still committed on the active child branch (build-region decision 11), and flat
features keep `performRebase`.

## Diagram

### Before (halt-record commits are ordinary replay candidates)

```mermaid
graph LR
    range["child range<br/>oldParent..oldTip<br/>code + halt-record commits"]
    plumb["restack-replay.ts<br/>replayChildRange"]
    upper["halt-only conflict<br/>upper child's record wins<br/>(may be older than parent)"]
    mixed["conflict on code + halt record<br/>merge-tree failed"]
    resolver["restack-resolver.ts<br/>resolveRestackConflict<br/>rebase todo = every candidate"]
    llm["provider resolver<br/>sees halt-record hunks"]
    fr9["FR-9 featureCommitsPreserved<br/>expectedSubjects = candidates"]
    halt["restack conflict halt<br/>needs-human"]

    range --> plumb
    plumb --> upper
    plumb --> mixed --> resolver --> llm
    llm -- "keep upstream empties halt commits" --> fr9 --> halt
    llm -- "replay source = older record at tip" --> halt
```

### After (halt-record commits are bookkeeping)

```mermaid
graph LR
    range2["child range<br/>oldParent..oldTip"]
    book["restack/halt-record-bookkeeping.ts<br/>isHaltRecordOnlyCommit<br/>newestHaltRecord (Resolved at, else Halted at)<br/>appendNewestHaltRecord<br/>omittedRewrites"]
    plumb2["replayChildRange<br/>skips halt-only commits<br/>halt-path conflict pins the accumulator"]
    resolver2["resolveRestackConflict<br/>todo omits halt-only commits<br/>halt path merge pinned to the rebase side"]
    llm2["provider resolver<br/>code paths only"]
    fr92["FR-9<br/>subjects of kept candidates"]
    tip["replayed tip<br/>+ one 'halt record: «slug»' commit<br/>only when the tip differs from the winner"]
    accept["path-ownership acceptance<br/>(decision 3, unchanged)"]
    journal[("restack journal rewrites<br/>omitted commit → nearest earlier rewrite<br/>trailing run → final tip")]

    range2 --> book
    book --> plumb2
    book --> resolver2
    resolver2 --> llm2 --> fr92
    plumb2 --> tip
    fr92 --> tip
    book --> tip
    tip --> accept
    tip --> journal
    callers["callers: runRestack (restack-executor.ts)<br/>and planned journal recovery (restack-recovery.ts)<br/>pass haltRecordSlug; replayConflict drops the halt path"]
    callers --> plumb2
    callers --> resolver2
```

### One child replay with halt-record bookkeeping

```mermaid
sequenceDiagram
    participant X as runRestack or journal recovery
    participant P as replayChildRange
    participant R as resolveRestackConflict
    participant B as halt-record-bookkeeping
    participant L as provider resolver
    X->>P: replay range onto newParent (haltRecordSlug)
    P->>B: skip halt-only commits, pin halt path
    alt clean, or conflict only on the halt record
        P->>B: carry newest record, map omitted commits
        P-->>X: tip + rewrites
    else conflict on another path
        P-->>X: merge-tree failed (paths minus halt record)
        X->>R: rebase todo = kept commits, halt path merge driver
        R->>L: conflicted code paths only
        L-->>R: resolution (FR-8, FR-9 over kept subjects)
        R->>B: carry newest record, map omitted commits
        R-->>X: tip + rewrites
    end
    X->>X: path-ownership check, journal rewrites
```

## Legend

- **Halt-only commit:** a non-merge commit whose changed paths are exactly `.docs/halted/«slug».md`.
  Apart from excluding merges, it is the predicate child-cursor, operator-round, restack-plan and
  restack-recovery already use.
- **Kept commit:** every other commit in the range, replayed under the existing rules of decision 3:
  patch-equivalent skipping, empty-commit handling, merges.
- **Newest record:** the tip must carry the winner. When the range never touched the record, the
  winner is the new parent's record. Otherwise it is the newer of the new parent's record and the
  range's old-tip record, by `Resolved at:` (or `Halted at:` when unresolved). A tie, or neither
  side parsing, picks the new parent's; when only one side parses, that side wins. One
  `halt record: «slug»` commit (no trailer, journal stamp) sets the winner when the tip differs.
- **Pinned halt path:** in a kept commit that also edits the halt record, the replayed tree takes
  the accumulator's record. The tip's bookkeeping commit then sets the newest record.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-28 | Initial generation | #3451: halt-record commits make stacked restacks conflict |
| 2026-10-28 | Plan update: both callers (runRestack and journal recovery) and bookkeeping inside replayChildRange and resolveRestackConflict | /plan found recovery re-runs both replay paths |
