# Components: DECIDE-time unmerged-overlap scan (#523, Scope A)

**Last updated:** 2026-07-21
**Scope:** The new read-only overlap-surfacing component invoked during DECIDE
(`/architecture-review` + `/plan`). Build side (`daemon-backlog`) is untouched and shown only
as an out-of-scope boundary for contrast.

## Diagram

```mermaid
graph TD
    subgraph DECIDE["DECIDE phase (engineer/authoring worktree)"]
        AR["/architecture-review<br/>(Wiring Surface: candidate call sites)"]
        PLAN["/plan<br/>(authoritative **Files:** set)"]
        SCAN["OverlapScan (NEW)<br/>read-only, advisory"]
        REPORT["Advisory report<br/>named overlaps + open blockers<br/>(to author, before plan locks)"]
    end

    subgraph NEWHELPERS["New engine helpers"]
        ENUM["UnmergedBranchEnumerator (NEW)<br/>list spec/«slug» + open-PR branches"]
        INTERSECT["FileOverlapIntersect (NEW)<br/>candidate Files ∩ changed paths"]
    end

    subgraph REUSED["Reused primitives (unchanged)"]
        DIFF["rebase.ts#changedPathsBetween<br/>git diff --name-only base..branch"]
        RESOLVER["blocker-resolver.resolve(sourceRef)<br/>gh api blocked_by"]
    end

    subgraph OUT["Out of scope (Scope B/C)"]
        BACKLOG["daemon-backlog discoverBacklog<br/>build-side gate — UNCHANGED"]
    end

    AR -->|candidate files| SCAN
    PLAN -->|**Files:** set| SCAN
    SCAN --> ENUM
    ENUM -->|each branch| DIFF
    DIFF --> INTERSECT
    SCAN -->|Source-Ref| RESOLVER
    INTERSECT --> REPORT
    RESOLVER --> REPORT
    REPORT -.->|author reconciles design<br/>before /plan locks| PLAN

    SCAN -.->|no persistence, no dispatch| BACKLOG
```

## Legend

- **NEW** nodes are the only production code this spec adds: an unmerged-branch enumerator, a
  file-overlap intersection, and the `OverlapScan` orchestrator that wires them to two reused
  primitives.
- **Reused** nodes already exist: `rebase.ts#changedPathsBetween` (git diff) and
  `blocker-resolver.resolve` (GitHub `blocked_by` API). This spec calls them; it does not
  modify them.
- **Out of scope** — `daemon-backlog` is drawn only to make the boundary explicit: the scan
  writes nothing and never touches build dispatch. The dotted "no persistence, no dispatch"
  edge is a *non*-interaction.
- `«slug»` is a placeholder for a per-idea branch slug.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-21 | Initial generation | Created during DECIDE for #523 Scope A |
