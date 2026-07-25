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
    GENERATE["Existing #937 record producer<br/>hash + render + write + commit<br/>production-proven by #943"]
    VERIFY["shipment-evidence backstop (NEW)<br/>strict parse + slug + PR + hash<br/>+ candidate-tree/head reachability"]
    ASSOC["shipment-association policy (NEW)<br/>exact plan stem + PR metadata<br/>+ non-spec implementation diff"]
    CLI["shipment-evidence CLI (NEW)<br/>check-pr + reconcile + audit<br/>+ configure-protection"]
    FINISH["Finish convergence seams<br/>finish-record + finish predicate<br/>+ complete-state verifier"]
    OUTCOME["Daemon outcome boundary<br/>mark processed + teardown"]
    MERGED["Merged-PR guard<br/>MERGED without durable evidence → HALT"]
    AUDIT["Audit/reconcile adapters (NEW)<br/>deterministic repair + paginated history<br/>+ complete/incomplete machine report"]
    PROTECT["Drift-safe protection adapter (NEW)<br/>exact ruleset read-modify-write<br/>+ Actions PR setting"]
  end

  subgraph GH["GitHub"]
    FEATUREPR["Implementation PR<br/>head branch carries code + record"]
    CHECK["shipped-record required check (NEW)<br/>GitHub Action on pull_request"]
    MAIN[("Protected main branch (ENHANCED)<br/>existing PR + human review rules<br/>add required shipped-record check")]
    RECON["post-merge reconcile job (NEW)<br/>GitHub Action on merged PR"]
    REPAIR["Idempotent record-only repair PR (NEW)<br/>human merge; never auto-merge"]
  end

  PLAN --> GENERATE
  GENERATE --> RECORD
  RECORD --> VERIFY
  PLAN --> VERIFY
  ASSOC --> VERIFY
  CLI --> ASSOC
  CLI --> AUDIT
  CLI --> PROTECT
  FINISH --> VERIFY
  VERIFY -->|"pass before terminal writes"| LOCAL
  VERIFY -->|"pass"| OUTCOME
  VERIFY -.->|"missing, malformed, mismatched,<br/>uncommitted, or unpushed → block"| FINISH
  OUTCOME -->|"only after pass"| LOCAL
  MERGED --> VERIFY
  MERGED -.->|"missing after out-of-band merge"| RECON

  RECORD --> FEATUREPR
  FEATUREPR --> CHECK
  CHECK --> CLI
  CHECK -->|"required success"| MAIN
  OP -->|"review + merge"| MAIN
  MAIN --> RECON
  RECON --> CLI
  AUDIT -->|"proven missing record"| REPAIR
  REPAIR -->|"creator verifies exact head<br/>and posts stable status"| CHECK
  OP -->|"review + merge"| REPAIR
  REPAIR --> MAIN

  AUDIT -->|"one-time full-history run<br/>writes verified records on this feature branch"| RECORD
  PROTECT -->|"after observed bootstrap context<br/>add one required check; preserve all rules"| MAIN
```

## Legend

- **Shared durable-evidence verifier** is the single policy seam used by engine completion,
  daemon ship/teardown, merged-PR handling, and the GitHub Action. It validates content and Git
  reachability; ignored local markers never substitute for repository evidence.
- **Protected `main`** already requires a squash pull request, one approving review, and code-owner
  review through repository ruleset `15933604`. This feature adds the shipped-record status check
  to that existing ruleset; it does not replace or weaken the current protections.
- **Repair PR** is record-only, idempotent, and human-merged. The Action never directly pushes to
  `main` and never auto-merges, preserving the existing non-autonomy boundary.
- **Proven association** means repository/GitHub evidence identifies both a plan/spec and its
  merged implementation PR. A local processed marker is corroborating evidence, not authority.
- **Protection cutover** occurs only after the bootstrap PR emits the stable context. The adapter
  refuses live-rule drift instead of reconstructing or weakening ruleset `15933604`.
- Dotted edges are blocking or recovery paths. `«»` denotes variable values.
- **#937/#943 baseline** remains the ordinary producer path. This feature does not replace it or
  change record schema/hash resolution; the new verifier prevents other engine and merge paths from
  claiming success without its durable output.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-25 | Initial generation | DECIDE architecture for issues #916/#936 and repaired example PR #877 |
| 2026-07-25 | Corrected `main` protection baseline | Ruleset inspection showed active PR/review protection; only the required evidence check is missing |
| 2026-07-25 | Added planned policy, CLI, audit, and protection seams | `/plan` fixed the module boundaries, call paths, repair-head status, and safe cutover sequence |
| 2026-07-25 | Narrowed around verified #937/#943 baseline | Current `main` already produces records on the ordinary finish path; remaining work is enforcement and recovery |
