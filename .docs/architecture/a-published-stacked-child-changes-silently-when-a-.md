# Sequence + Components: Refresh a published stack after a routed fix (#3269)

**Last updated:** 2026-11-01
**Scope:** The first post-publication engine write path. A routed round may now run on a published
stack. The restack records each member it moves, and FINISH refreshes those members on GitHub after
the leaf gates pass, then posts one comment per routed fix on the host and on any member above it whose own diff changed. Governing decision: `adr-2026-11-01-routed-fix-refreshes-a-published-stack`. These
diagrams show only what this spec builds. Routed repair itself is drawn in
[`whole-feature-audit-fixes-cannot-land-in-the-stack.md`](whole-feature-audit-fixes-cannot-land-in-the-stack.md).

## Diagram: components

```mermaid
graph TD
  subgraph Entry["Entry points that may pass the freeze"]
    ADM["Route admission (audit rounds)"]
    OP["stack land (operator rounds)"]
    PRE["Tip preflight: remote equals every pushed receipt"]
  end
  subgraph Round["Routed round"]
    EXIT["Routed exit restack"]
    LEDGER["Refresh ledger ref: refs/conductor/«slug»/refresh"]
    RET["Leaf return re-pends leaf gates and finish, not rebase"]
    REOPEN["Reopen: stack land sweeps finish-choice and DONE; backlog admits the slug"]
  end
  subgraph Finish["FINISH publication"]
    REFRESH["Member refresh, bottom up"]
    GUARD["Tip guard: fast-forward, or a tip the ledger recorded"]
    COMMENT["Routed-fix comment poster"]
  end
  GH["GitHub member PRs"]
  SPINE["Event spine"]
  ADM --> PRE
  OP --> PRE
  PRE --> REOPEN
  REOPEN --> EXIT
  EXIT -- "same update-ref transaction as applied" --> LEDGER
  EXIT --> RET
  RET --> REFRESH
  REFRESH --> LEDGER
  REFRESH --> GUARD
  GUARD -- "force-with-lease at the pushed receipt" --> GH
  REFRESH --> COMMENT
  COMMENT -- "guarded pull-request.comment.create, per-member target" --> GH
  COMMENT --> LEDGER
  REFRESH --> SPINE
  COMMENT --> SPINE
```

## Diagram: sequence

```mermaid
sequenceDiagram
  participant R as Routed exit
  participant L as Refresh ledger
  participant F as FINISH
  participant G as Tip guard
  participant H as GitHub
  R->>L: In the applied transaction, record old pushed tip, new tip, round
  Note over R,F: Revalidation drains, the worktree returns to the leaf, and the leaf gates re-run
  F->>L: Read pending members
  loop Each moved member, bottom up
    F->>G: Push new tip to the member branch
    G->>H: ls-remote every member
    alt Every tip matches its receipt, and the source descends from the recorded tip
      G->>H: Push with force-with-lease at the receipt
      G->>L: Pushed receipt advances with the push
      F->>F: Emit stack_member_refreshed
    else Any tip differs
      G-->>F: Refused
      F->>F: Halt stack-tip-diverged, naming the member
    end
  end
  loop Each pending comment
    F->>H: List comments on the host, or on a member above whose own diff changed, and look for the marker
    alt Marker absent
      F->>H: Guarded comment create
    else Lookup failed
      F-->>F: Retryable failure, nothing is created
    end
    F->>L: Record the comment receipt
    F->>F: Emit stack_member_comment_posted
  end
```

## Legend

- **Refresh ledger:** a durable ref holding, per member, the tip last pushed, the tip the restack recorded, and the rounds still owed a comment. A member above the host is owed one only when its patch id differs.
- **Tip guard:** `stack-tip-guard.ts`. Everything outside this path stays fast-forward only.
- **«slug»:** the feature slug.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-01 | Initial generation | #3269 first post-publication write path |
