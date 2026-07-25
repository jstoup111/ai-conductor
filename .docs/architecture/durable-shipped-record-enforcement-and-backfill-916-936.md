# Components: durable shipped-record enforcement and backfill (#916, #936)

**Last updated:** 2026-07-25
**Scope:** Engine-owned durable shipment evidence, protected-branch enforcement, post-merge
repair PRs, and the one-time historical audit. Technical track, tier M. Existing record
rendering and GitHub/daemon seams are reused; no new service or database is introduced.

## Diagram

```mermaid
graph TD
  OP["Operator<br/>reviews and merges PRs"]

  subgraph WT["Feature worktree"]
    PLAN[(".docs/plans/«slug».md<br/>+ optional stories")]
    RECORD[(".docs/shipped/«slug».md")]
    LOCAL[(".pipeline terminal state<br/>+ .daemon processed cache")]
  end

  subgraph ENGINE["Conductor engine"]
    GENERATE["Existing record generator<br/>hash + render + write + commit"]
    VERIFY["Shared durable-evidence verifier (NEW)<br/>slug + PR + hash + committed HEAD<br/>+ pushed PR-head ancestry"]
    FINISH["Finish convergence seams<br/>finish-record + finish predicate<br/>+ complete-state verifier"]
    OUTCOME["Daemon outcome boundary<br/>mark processed + teardown"]
    MERGED["Merged-PR guard<br/>MERGED without durable evidence → HALT"]
    AUDIT["Audit/reconcile entry point (NEW)<br/>candidate discovery + proven PR association<br/>ambiguous → report only"]
  end

  subgraph GH["GitHub"]
    FEATUREPR["Implementation PR<br/>head branch carries code + record"]
    CHECK["shipped-record required check (NEW)<br/>GitHub Action on pull_request"]
    MAIN[("Protected main branch (NEW)<br/>PR + required checks + human review")]
    RECON["post-merge reconcile job (NEW)<br/>GitHub Action on merged PR"]
    REPAIR["Idempotent record-only repair PR (NEW)<br/>human merge; never auto-merge"]
  end

  PLAN --> GENERATE
  GENERATE --> RECORD
  RECORD --> VERIFY
  PLAN --> VERIFY
  FINISH --> VERIFY
  VERIFY -->|"pass before terminal writes"| LOCAL
  VERIFY -->|"pass"| OUTCOME
  VERIFY -.->|"missing, malformed, mismatched,<br/>uncommitted, or unpushed → block"| FINISH
  OUTCOME -->|"only after pass"| LOCAL
  MERGED --> VERIFY
  MERGED -.->|"missing after out-of-band merge"| RECON

  RECORD --> FEATUREPR
  FEATUREPR --> CHECK
  CHECK --> VERIFY
  CHECK -->|"required success"| MAIN
  OP -->|"review + merge"| MAIN
  MAIN --> RECON
  RECON --> AUDIT
  AUDIT -->|"proven missing record"| REPAIR
  OP -->|"review + merge"| REPAIR
  REPAIR --> MAIN

  AUDIT -->|"one-time full-history run<br/>writes verified records on this feature branch"| RECORD
```

## Legend

- **Shared durable-evidence verifier** is the single policy seam used by engine completion,
  daemon ship/teardown, merged-PR handling, and the GitHub Action. It validates content and Git
  reachability; ignored local markers never substitute for repository evidence.
- **Protected `main`** requires pull requests, human review, and the shipped-record status check.
  The repository currently lacks protection; adding it is part of this feature's operational
  delivery.
- **Repair PR** is record-only, idempotent, and human-merged. The Action never directly pushes to
  `main` and never auto-merges, preserving the existing non-autonomy boundary.
- **Proven association** means repository/GitHub evidence identifies both a plan/spec and its
  merged implementation PR. A local processed marker is corroborating evidence, not authority.
- Dotted edges are blocking or recovery paths. `«»` denotes variable values.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial generation | DECIDE architecture for issues #916/#936 and repaired example PR #877 |
