# Sequence + Components: Multi-branch restack for stacked child plans

**Last updated:** 2026-10-10
**Scope:** How a change to stacked child k is carried into every existing child above it (#2943).

Covered:
- the triggers: FINISH `rebase` step, daemon re-kick, automatic repair of an operator commit on a
  closed child, and interrupted-operation recovery. Restacks happen only where rebases happen today;
- the ref-backed restack journal and its state machine;
- the off-worktree replay, tree-prediction verification and the atomic compare-and-swap ref move;
- conflict hand-off, cause-scoped refunds and the per-child cascade cap;
- expected-SHA push leases.

Out of scope:
- routed-fix producers, re-validating closed children, and rewinding a closed child (#2944);
- child publication and published-stack adoption (#2945).

With no child, every path below collapses to today's `performRebase`. The only N=1 difference is the
expected-SHA push lease.

## Definitions used by every diagram

- **Existing children.** Restack moves only branches that exist: closed children plus the active
  child. Unstarted children have no branch; they are created later from the moved closure tip, as
  today. The leaf `feat/daemon-«slug»` is moved by restack only when it is the active child.
  Otherwise it stays with `moveLeaf`, whose stray-commit guard is unchanged.
- **Ranges.**
  - Child 1's old parent is `merge-base(c1, old default tip)`. Child j>1's old parent is the
    journaled closure tip of j-1.
  - A closed child's own range is `oldParent..closure(j)`. The active child's own range is
    `oldParent..tip(j)`.
  - Halt-record-only commits past a closure are not replayed: the cursor already tolerates them, and
    the halt record lives on the active branch.
  - Halt-record commits inside a range are replayed like any other commit. A conflict on
    `.docs/halted/«slug».md` is resolved mechanically: the record on the child above wins.
- **Cause.** `feature-repair` means a child below moved: an operator commit on a closed child, a
  rewind, or, from #2944, a routed fix. `base-refresh` means the default branch moved. When both are
  needed they run as two chained operations: repair first, then refresh. Each has its own operation
  id, refund receipt and cap accounting.
- **Durable homes.** Everything the restack must keep across a worktree recreation (#497) lives
  under `refs/conductor/«slug»/`, following the `positions` precedent. Nothing lives in
  `.pipeline/`.
  - the journal blob: `restack/«opId»`;
  - staging refs that pin planned commits: `restack/«opId»/c«j»`;
  - recorded pushed tips: `pushed/«branch»`;
  - the per-child cascade counters, in a ref-backed blob.

## Diagram: journal state machine

```mermaid
stateDiagram-v2
    [*] --> planned: journal CAS-created with cause, old SHAs, ranges
    planned --> ready: every child replayed and path-ownership checked, new SHAs pinned by staging refs
    planned --> aborted: conflict unresolved, replay mismatch, any halt
    ready --> moved: one update-ref transaction moves refs, leaf-moved marker and journal state together
    ready --> aborted: transaction refused (a journaled ref changed)
    moved --> rolling_back: post-move verification failed
    rolling_back --> aborted: reverse CAS transaction
    moved --> synced: checked-out worktree synchronised, seal rotated
    synced --> applied: rewrite maps, transitions, refunds, cascade count in the same transaction
    applied --> [*]: journal and staging refs deleted
    aborted --> [*]: no ref moved, both sides recoverable from unmoved refs and staging refs
```

## Diagram: restack operation

```mermaid
sequenceDiagram
    participant Trig as trigger
    participant Plan as restack planner
    participant Jrn as journal (refs/conductor)
    participant Rep as off-worktree replayer
    participant Git as git refs + objects
    participant WT as feature worktree
    participant Res as rebase resolver
    participant Tr as transition + ledger
    participant Spine as event spine

    Trig->>Plan: restack request (cause feature-repair or base-refresh)
    Plan->>Jrn: any journal not applied or aborted?
    alt outstanding journal
        Plan->>Plan: run recovery (see triggers and recovery diagram), never start a second operation
    end
    Plan->>Git: read closure refs, existing child branches, leaf, default tip
    Plan->>Plan: compute old parents and own ranges per existing child above k (see Definitions)
    Plan->>Tr: feature-repair only: originating child's cascade count below its cap?
    alt cap reached for child j
        Plan->>Spine: restack_refused {child j, reason cascade-cap}
        Plan-->>Trig: needs-human HALT naming child j (no journal written)
    end
    Plan->>Jrn: CAS-create journal, state planned {opId, cause, every ref with old SHA, ranges}
    loop each existing child j above k, bottom-up
        Rep->>Git: first-parent replay of own range onto new parent with merge-tree --write-tree + commit-tree, author and dates copied, committer date pinned, empties dropped
        alt conflict on commit c
            Rep-->>Plan: conflict {child j, commit c, paths}
            Plan->>Res: hand child j to the narrow resolver in a temporary detached worktree, rebase --onto newParent oldParent, no branch argument
            alt resolver accepts (FR-8 base newParent, FR-9 range oldParent..ORIG_HEAD, path ownership)
                Res-->>Rep: resolved tip for child j, marked resolved in journal
            else unresolved
                Plan->>Jrn: state aborted, no ref has moved
                Plan->>Spine: restack_conflict {child j, commits}
                Plan-->>Trig: needs-human HALT naming child j and conflicting commits
            end
        else clean replay
            Rep->>Rep: path ownership, diff newParent..newTip paths within diff oldParent..oldTip paths
            alt path outside owned set
                Plan->>Jrn: state aborted, no ref has moved
                Plan-->>Trig: HALT replay-mismatch naming child j and commit
            end
        end
        Rep->>Git: pin new tip with staging ref restack/«opId»/c«j»
        Note over Rep: next child replays onto the actual new tip of j, resolved or clean
    end
    Plan->>Jrn: state ready with every new SHA
    Plan->>WT: dry run read-tree -m -u -n old new, refuse dirty paths in the delta, quarantine untracked collisions, check seal
    Plan->>Git: one update-ref --stdin transaction, old-value CAS on every journaled branch and closure ref plus journal state moved
    alt any journaled ref changed since planned
        Git-->>Plan: transaction refused, nothing moved
        Plan->>Jrn: state aborted
        Plan-->>Trig: HALT stack-ref-changed naming the ref
    end
    Plan->>Git: verify tips equal journal, ancestry chain c1 up to leaf, trees equal staging refs
    alt verification fails
        Plan->>Git: reverse CAS transaction, journal rolling-back then aborted
        Plan-->>Trig: HALT naming the failed check
    end
    Plan->>WT: sync checked-out branch from old to new tip (read-tree -m -u), rotate seal, current-task preserved
    Plan->>Jrn: state synced
    Plan->>Tr: write per-child rewrite map entries into the flat map, keyed by SHA, pre-image range oldParent..oldTip
    Tr->>Tr: active child transition with its own tuple, whole-feature gates with the whole-stack tuple, closed children keep verdicts (wouldInvalidate emitted)
    Tr->>Tr: refund build_review only when cause is base-refresh, count one cascade on the originating child when feature-repair
    Plan->>Jrn: state applied, written in the same transaction as the cascade count
    Plan->>Spine: restack_applied {child per moved child, cause, opId}
```

## Diagram: triggers and recovery

```mermaid
flowchart TD
    RSM["conductor resume or daemon dispatch"] --> JR{"journal outstanding?"}
    JR -- "planned" --> PL["keep replayed or resolved staging refs whose inputs are unchanged, resume planning, else abort"]
    JR -- "ready (refs still old)" --> TX["re-run the move transaction with journaled SHAs"]
    JR -- "moved" --> SY["bounded sync of delta paths, dirty check skipped for our own drift"]
    JR -- "rolling-back" --> RB["re-run reverse transaction"]
    JR -- "synced" --> AP["apply transition, mark applied"]
    JR -- "applied or aborted leftover" --> CL["delete journal, staging refs, temporary worktree"]
    JR -- "unreadable or refs match neither side" --> H["needs-human HALT naming refs"]
    JR -- "none" --> SUP["halt-record supersede, cursor, classifyRebaseOperation"]
    TX --> SY --> AP --> SUP
    PL --> SUP
    RB --> SUP
    CL --> SUP

    SUP --> APP{"closed child has commits appended past its closure?"}
    APP -- "yes, closure is ancestor of tip" --> FR["automatic feature-repair restack from that child"]
    APP -- "rewritten or reset back" --> DH["needs-human divergent HALT"]
    APP -- no --> SEL["select next step"]

    FIN["FINISH rebase step, after the stack preflight"] --> STK{"children exist?"}
    RK["daemon re-kick (sentinel)"] --> STK
    STK -- no --> N1["today's performRebase, pinned config"]
    STK -- "yes, any active child" --> MOVED{"default tip already an ancestor of child 1?"}
    MOVED -- yes --> NOOP["noop"]
    MOVED -- no --> BR["base-refresh restack: child 1 onto default, then existing children up to top"]
    FR -. "base refresh also due" .-> BR
```

Resume reads the journal before the halt-record supersede, the cursor, `classifyRebaseOperation`
and `consumeResumeAuthorizations`. A journal that is still outstanding is therefore never misread as
divergence. The one-shot `REKICK` sentinel is consumed before the restack runs, so crash recovery
depends only on the journal.

## Diagram: expected-SHA push leases

```mermaid
sequenceDiagram
    participant Site as force-push caller (draft refresh, pushRefreshedBranch for autoresolve and ci-fix, publishHaltRecord)
    participant Exec as executeRemoteGit chokepoint
    participant Tips as refs/conductor/«slug»/pushed/«branch»
    participant Remote as origin

    Site->>Remote: fetch the one branch (refreshes tracking ref for the pre-push hook)
    Site->>Tips: read recorded tip
    Site->>Site: remote tip R vs recorded tip and pushed HEAD
    alt R equals recorded, or R is an ancestor of HEAD
        Site->>Tips: write intent {expected R, new HEAD}
        Site->>Exec: push --force-with-lease=refs/heads/«branch»:R
    else no recorded tip (in flight before this change)
        Site->>Exec: today's push once
    else anything else
        Site-->>Site: refuse, push_lease_refused naming ref and both SHAs
    end
    Exec->>Remote: push
    Remote-->>Exec: accepted
    Exec->>Tips: CAS-record new tip (every successful feature-branch push, plain or forced)
    Note over Exec,Tips: refs deleted at shipped-record teardown so a reused slug inherits nothing
```

## Diagram: components touched

```mermaid
graph TD
    subgraph Existing["#2940 and #2942 (existing)"]
        CUR[child-cursor.ts: active child, divergence, resolveChildBase]
        LIFE[child-lifecycle.ts: startChild, switchToChild, closeChild, moveLeaf, enterChildRegion]
        HRC[halt-record.ts: commits on active branch]
    end
    subgraph New["new in #2943"]
        PLAN[restack/restack-plan.ts + restack-executor.ts: cause, ranges, existence filter]
        SEAL[protected-artifact seal: check and rotate]
        JRN[restack/restack-journal.ts + restack-recovery.ts: refs/conductor journal, staging refs]
        REP[restack/restack-replay.ts + restack-ownership.ts: merge-tree + commit-tree, path ownership]
        TXN[restack/restack-move.ts + restack-sync.ts: update-ref --stdin CAS, worktree sync]
        LEASE[push-lease.ts + executeRemoteGit recording]
    end
    subgraph Rebase["rebase machinery (amended)"]
        PR[rebase.ts performRebase: N=1 path, pinned flags]
        RES[restack/restack-resolver.ts: temporary detached worktree, FR-8/FR-9 ranges]
        TRN[rebase-translate.ts: explicit pre-image range]
        RPL[rebase-replay.ts: per-child replay identity]
        TRS[rebase-transition.ts: cause on operation, cause-scoped refund]
        CRO[classifyRebaseOperation / completeInterruptedRebaseOperation]
    end
    subgraph Callers["triggers (amended)"]
        FINS[conductor.ts runRebaseStep]
        RKK[daemon-rekick.ts resumeRebaseFirst + consumeResumeAuthorizations]
        RWD[rewind.ts: refusal re-pointed to 2944]
        RSM[conductor.ts resume: journal first]
    end
    subgraph Push["leaf push sites (lease retrofit)"]
        SDP[ship-draft-pr.ts]
        AR[autoresolve.ts + ci-fix.ts]
    end
    KL[kickback-ledger.ts + restack/cascade-cap.ts: receipts, cascades ref]
    EV[types/events.ts: restack events with child]

    RSM --> JRN
    RSM --> CUR
    RSM --> CRO
    FINS --> PLAN
    RKK --> PLAN
    CUR --> PLAN
    PLAN --> JRN
    PLAN --> REP
    REP --> RES
    PLAN --> TXN
    TXN --> SEAL
    TXN --> LIFE
    PLAN --> TRN
    PLAN --> RPL
    PLAN --> TRS
    TRS --> KL
    PRE[restack/stack-preflight.ts: journal recovery, then repair] --> JRN
    PRE --> PLAN
    RSM --> PRE
    RKK --> PRE
    FINS --> PRE
    GC[guarded-engine-commit.ts + git-pinned-config.ts] --> JRN
    PLAN --> EV
    FINS --> PR
    RKK --> PR
    SDP --> LEASE
    AR --> LEASE
    HRC --> LEASE
```

## Legend

- **closure ref** is `refs/conductor/«slug»/closed/c«k»`. Until now it was create-only (ADR D1).
  This feature lets it move by compare-and-swap, but only inside a journaled restack transaction.
- **Atomicity** covers refs and the journal state together. A crash between `moved` and `synced`
  leaves the worktree out of step with its branch. A commit fence stops engine commits in that
  window, and recovery syncs only the delta paths.
- **Halts and the journal.** A halt raised while the journal is `ready`, `moved` or `rolling-back`
  writes its HALT marker immediately. Its committed record waits until the journal reaches `synced`
  or `aborted`.
- **N=1** never enters the planner. It uses `performRebase` as today, with pinned git config, and
  push leases are recorded for every feature.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | #2943 DECIDE: Approach B (journaled off-worktree replay) |
