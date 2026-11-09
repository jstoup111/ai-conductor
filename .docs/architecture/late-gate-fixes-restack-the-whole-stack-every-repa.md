# Components: Routed Audit Fixes Run on the Leaf and Fold onto Their Owners Once Before Publish (#3653)

**Last updated:** 2026-11-08
**Scope:** How a stacked feature's whole-feature audit round (`prd_audit`,
`architecture_review_as_built`, `manual_test`, post-region custom steps) places routed fixes
without restacking the children above each host every round, and how those fixes reach the PR of
their owning child once, before publication. Covers the audit host's region entry and routed exit
(`routing/host-region-entry.ts`, `routing/routed-exit.ts`, `routing/round-admission.ts`), the
commit-hook round stamp (`round-stamp-cli.ts`, `git-hook-assets.ts`), a new `fold` restack cause
(`restack/restack-plan.ts`, `restack/restack-executor.ts`, `restack/restack-transition.ts`), the
existing revalidation queue (`routing/revalidation-queue.ts`), the FINISH `rebase` step and
publication (`finish-publication-production.ts`), and the event spine (`types/events.ts`).
Operator rounds (`stack land`, closed-child `rewind`) and `revalidate` rounds keep today's
owner-branch execution.

## Diagram

```mermaid
graph TD
    subgraph Gates["Whole-feature gates on the leaf (unchanged)"]
        WG["prd_audit / as-built /<br/>manual_test / custom steps"]
        ROUTE["Routing (unchanged)<br/>owner derivation, residue judge,<br/>selectHost, route record, receipt"]
    end

    subgraph Round["Audit round execution"]
        ENTRY["Host region entry<br/>NEW: audit round checks out the LEAF<br/>branch; host «k» is the placement owner"]
        STAMP["round-stamp hook<br/>Round: «roundId» (existing)<br/>NEW: Owner: c«k» from the marker"]
        REGION["Host region steps on the leaf<br/>acceptance verify-green, build,<br/>test_suite, build_review (host-scoped)"]
        EXIT["Routed exit<br/>NEW: leaf-executed host → done,<br/>placement deferred; NO exit restack,<br/>NO revalidate queue entry"]
        REC[("routes/«roundId»<br/>items: findingId → owner/host<br/>NEW: per-host placement: deferred")]
    end

    subgraph Fold["NEW: fold restack (once per publish)"]
        TRIG["FINISH rebase step / stack preflight<br/>deferred placements present<br/>and every round closed"]
        PLAN["Fold planner<br/>reads Owner: trailers in the leaf's<br/>post-closure range; partitions hunks:<br/>target = max(owner, child that<br/>introduced the hunk's lines)"]
        JOUR[("Restack journal<br/>NEW cause: fold<br/>fold plan recorded before any ref moves")]
        REPLAY["Journaled per-commit replay<br/>(existing executor + resolver)"]
        TREE["NEW: leaf-tree identity check<br/>new leaf tree == pre-fold leaf tree"]
        HALT["needs-human HALT naming<br/>the commit and the child"]
    end

    subgraph Revalidate["Per-child re-validation (existing machinery)"]
        Q[("refs/.../revalidate queue<br/>every child the fold changed")]
        RV["revalidate round per child<br/>acceptance, test_suite, build_review"]
        FIX["Failure → bounded repair<br/>on that child (existing kickback)"]
        ADM["Shared admission helper<br/>NEW caller: FINISH rebase step<br/>after the fold"]
        RET["NEW: returnToLeaf fold mode<br/>leaf tree unchanged → no gate re-pend;<br/>navigate to rebase → base refresh"]
    end

    subgraph Publish["Publication (unchanged)"]
        PUB["establishChildPrs<br/>ancestry check, push closures,<br/>draft PRs"]
    end

    subgraph Spine["Event spine"]
        EV["NEW: fold_planned / fold_applied<br/>per commit: owner, placed children<br/>NEW: provider_attempt.roundId,<br/>restackOpId on resolver dispatches"]
    end

    WG --> ROUTE --> REC --> ENTRY
    ENTRY --> STAMP --> REGION --> EXIT --> REC
    EXIT -- "round closed; leaf gates re-run" --> WG
    WG -- "gates converge" --> TRIG
    TRIG --> PLAN --> JOUR --> REPLAY --> TREE
    PLAN -- "owner unknown /<br/>hunk has no placeable target" --> HALT
    REPLAY -- "resolver exhausted" --> HALT
    TREE -- "mismatch → rollback" --> HALT
    TREE -- "identical: leaf verdicts kept" --> Q
    Q --> ADM --> RV
    RV -- "queue drained" --> RET --> PUB
    RV -- "fail" --> FIX
    FIX -- "cap exhausted" --> HALT
    FIX --> RV
    PLAN -.-> EV
    REPLAY -.-> EV
```

## Sequence: one audit round, then the fold

```mermaid
sequenceDiagram
    participant Gate as Leaf whole-feature gate
    participant Router as Routing (unchanged)
    participant Leaf as Leaf branch
    participant Hook as round-stamp hook
    participant Fold as Fold restack
    participant Q as Revalidation queue
    participant Fin as FINISH publication

    Gate->>Router: findings (round r«n»)
    Router->>Router: owner per finding, host order, route record
    loop each host «k» in ascending order
        Router->>Leaf: region entry on the leaf, marker host «k»
        Leaf->>Hook: commit
        Hook-->>Leaf: Round: r«n», Owner: c«k»
        Leaf->>Router: region passes → host done, placement deferred
    end
    Router->>Gate: round closed → leaf gates re-run (no restack ran)
    Note over Gate,Router: further rounds repeat with zero restacks
    Gate->>Fold: gates converge → FINISH rebase step
    Fold->>Fold: plan: each Owner-stamped commit → owner, raised hunks → introducing child
    Fold->>Fold: journal plan, replay, resolve conflicts once
    Fold->>Fold: assert leaf tree unchanged
    Fold->>Q: enqueue every changed child
    Q->>Q: revalidate each child once (bounded repair on failure)
    Q->>Fin: queue drained
    Fin->>Fin: publish child PRs with fixes in their owners
```

## Legend

- **Owner** is the child routing names for a finding (unchanged authority). **Host** is today's
  executing child; for an audit round it becomes the placement owner, while execution happens on
  the leaf.
- **Owner floor:** a fix never lands below its routed owner. A hunk moves above the owner only
  when the lines it edits were introduced by a higher child, so they do not exist at the owner.
- **Leaf-tree identity:** the fold may only redistribute commits; the leaf's final tree must equal
  its pre-fold tree, so the whole-feature verdicts already earned on the leaf stay valid.
- `NEW:` marks behaviour this feature adds; unmarked boxes are existing machinery.
- `«…»` are placeholders.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-08 | Initial generation | #3653: defer routed audit-fix placement to one fold before publish |
| 2026-11-08 | Added rebase-step queue admission and fold-mode leaf return | Architecture review: the rebase step does not read the queue today, and `returnToLeaf` re-pends unconditionally |
