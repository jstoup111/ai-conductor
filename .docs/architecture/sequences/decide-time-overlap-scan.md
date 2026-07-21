# Sequence: DECIDE-time overlap scan (#523, Scope A)

**Last updated:** 2026-07-21
**Scope:** The read-only scan flow that surfaces unmerged seam-overlap and open blockers to a
spec author before the plan locks. Covers happy path, the quiet negative path, and graceful
degradation.

## Diagram

```mermaid
sequenceDiagram
    participant Author as DECIDE author<br/>(/architecture-review, /plan)
    participant Scan as OverlapScan
    participant Git as git (local)
    participant Resolver as blocker-resolver
    participant GH as gh (blocked_by API)

    Author->>Scan: run(candidateFiles, sourceRef)

    Note over Scan,Git: Seam-overlap sweep (branches)
    Scan->>Git: list unmerged spec/«slug» + open-PR branches
    alt enumeration fails
        Git-->>Scan: error
        Scan-->>Author: advisory-skip note (never blocks authoring)
    else branches listed
        loop each unmerged branch
            Scan->>Git: changedPathsBetween(base, branch)
            Git-->>Scan: changed paths
            Scan->>Scan: intersect with candidateFiles
        end
    end

    Note over Scan,GH: Blocker sweep (issue links)
    opt sourceRef present
        Scan->>Resolver: resolve(sourceRef)
        Resolver->>GH: api .../dependencies/blocked_by
        GH-->>Resolver: open blockers (or error)
        Resolver-->>Scan: verdict (blocked / unblocked / indeterminate)
    end

    alt overlaps or open blockers found
        Scan-->>Author: report — named file overlaps + branch,<br/>open blockers with unmerged specs/impls
    else clean
        Scan-->>Author: (quiet — zero ceremony, no prompt)
    end
```

## Legend

- **Quiet negative path** — when there are no overlapping branches and no open blockers, the
  scan emits nothing the author must act on (intake desired outcome: "zero added ceremony or
  prompts").
- **Graceful degradation** — a branch-enumeration or resolver failure degrades to an advisory
  note; the scan never blocks authoring (it is advisory, not a gate). An `indeterminate`
  resolver verdict is surfaced as such, not silently dropped.
- The base ref is resolved the same way `rebase.ts#resolveBase` does (`origin/«default»`,
  degrading to local base) — never hardcoded `main`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-21 | Initial generation | Created during DECIDE for #523 Scope A |
