# Architecture: Park-Marker Main-Root Resolution (#486)

**Last updated:** 2026-07-10
**Scope:** Where `.daemon/parked/«slug»` markers are written and read across the daemon,
the conductor (running inside a feature worktree), the park/unpark CLI, and the
dashboard — before and after anchoring every park operation to the MAIN repository root.

## Diagram — before (bug): two disjoint roots

```mermaid
graph TD
    subgraph MAIN["Main checkout root"]
        GATE["rekick sweep gate<br/>isOperatorParked"]
        DASH["dashboard / stale-park listing"]
        MARKMAIN[("main .daemon/parked/«slug»<br/>(what the gate reads)")]
    end

    subgraph WT["Feature worktree .worktrees/«slug»"]
        COND["conductor auto-park<br/>checkAndAutoPark(projectRoot)"]
        MARKWT[("worktree .daemon/parked/«slug»<br/>(stranded — nothing reads it)")]
    end

    CLI["conduct-ts daemon park/unpark<br/>resolves process.cwd()"]

    COND -- "writes (projectRoot = worktree)" --> MARKWT
    CLI -- "run from worktree: writes" --> MARKWT
    CLI -- "run from main: writes" --> MARKMAIN
    GATE -- reads --> MARKMAIN
    DASH -- reads --> MARKMAIN
    MARKWT -. "invisible to gate → capped feature<br/>re-dispatches every sweep" .-> GATE
```

## Diagram — after (fix): one resolved root

```mermaid
graph TD
    subgraph PM["park-marker.ts (single source)"]
        RESOLVE["resolveMainRepoRoot(startDir)<br/>git rev-parse --git-common-dir → parent<br/>fallback: startDir when not a git repo"]
        PRIMS["write / read / remove / list / provenance<br/>(all route through RESOLVE)"]
    end

    COND["conductor auto-park<br/>(projectRoot = worktree)"]
    CLI["daemon park/unpark CLI<br/>(cwd = anywhere in repo)"]
    GATE["rekick sweep gate"]
    DASH["dashboard / stale-park listing"]
    RECON["one-time sweep reconciliation<br/>moves stranded worktree markers"]

    MARKMAIN[("main .daemon/parked/«slug»")]
    COUNTER[("worktree .pipeline/task-evidence.json<br/>no-evidence counter")]

    COND --> PRIMS
    CLI --> PRIMS
    GATE --> PRIMS
    DASH --> PRIMS
    PRIMS --> RESOLVE
    RESOLVE --> MARKMAIN
    RECON -- "worktree marker found → move to main root" --> MARKMAIN
    CLI -- "unpark(auto): reset counter IN WORKTREE" --> COUNTER
    CLI -- "park: echo absolute marker path" --> MARKMAIN
```

## Sequence — auto-park then sweep (after fix)

```mermaid
sequenceDiagram
    participant C as Conductor (in worktree)
    participant PM as park-marker.ts
    participant G as git
    participant FS as main .daemon/parked/
    participant S as rekick sweep (daemon)

    C->>PM: writeAutoPark(projectRoot=worktree, «slug», reason)
    PM->>G: rev-parse --git-common-dir (from worktree)
    G-->>PM: «main»/.git → main root
    PM->>FS: create «slug» marker (wx, idempotent)
    Note over FS: marker now lives where the gate looks

    S->>PM: isOperatorParked(mainRoot, «slug»)
    PM->>G: rev-parse --git-common-dir (from main)
    G-->>PM: same main root
    PM->>FS: read «slug»
    FS-->>S: parked = true → skip re-dispatch
```

## Legend

- Cylinders are filesystem state; boxes are code paths.
- `«slug»` is the feature slug placeholder.
- Dotted arrow (before-diagram) marks the fail-open gap: the gate never sees the
  worktree-stranded marker, so the capped feature re-dispatches on every sweep.
- `resolveMainRepoRoot` falls back to the given directory when it is not inside a git
  repository — this preserves tmp-dir unit tests and non-git consumers byte-for-byte.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | Engineer DECIDE for #486 (tier M, technical track) |
