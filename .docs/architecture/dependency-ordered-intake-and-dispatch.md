# Components + Sequences: Dependency-Ordered Intake and Dispatch

**Last updated:** 2026-07-03
**Scope:** Where dependency gating sits in the daemon's discovery path (`discoverBacklog`) and
the engineer intake claim path, the shared blocker-resolution seam over the GitHub issue graph,
the new WAITING dashboard group, and the one-time prose→link migration. PRD:
`.docs/specs/2026-07-03-dependency-ordered-intake-and-dispatch.md` (issue #229).

## Component View (the shared seam)

```mermaid
graph TD
  subgraph daemon["daemon discovery + dispatch"]
    DB["discoverBacklog - per-spec gauntlet"]:::existing
    CF["Existing content filters - plan, stories, processed"]:::existing
    OG["OwnerGate"]:::existing
    DG["DependencyGate - build / wait decision"]:::new
    PICK["pickEligible + dispatch"]:::existing
  end

  subgraph dash["dashboard / status"]
    SCAN["scanInheritedState"]:::existing
    WAIT["WAITING group - blocked specs + reasons"]:::new
    REND["renderDashboard"]:::existing
  end

  subgraph intake["engineer intake"]
    Q["intake queue + ledger"]:::existing
    CLAIM["claim - oldest UNBLOCKED pending"]:::new
  end

  subgraph seam["Blocker resolution seam"]
    BR["BlockerResolver - open blockers for an issue ref"]:::iface
    CACHE["per-scan cache"]:::new
  end

  subgraph ext["External"]
    GH["GitHub issue graph - native blocked-by relations via gh"]:::ext
  end

  MIG["migration command - prose to native links, one-time"]:::new

  DB --> CF
  CF --> OG
  OG --> DG
  DG --> PICK
  DG -- "issue ref from Source-Ref intake marker" --> BR
  CLAIM --> BR
  BR --> CACHE
  BR -- "read relations + states" --> GH
  DG -- "wait: skip with reason, not dropped" --> WAIT
  SCAN --> WAIT
  WAIT --> REND
  Q --> CLAIM
  MIG -- "parse prose, propose, operator confirms, write links" --> GH

  classDef new fill:#cce5ff,stroke:#004085,stroke-width:2px;
  classDef iface fill:#e2e3ff,stroke:#383d7c,stroke-dasharray:4 2;
  classDef existing fill:#d4edda,stroke:#155724;
  classDef ext fill:#eeeeee,stroke:#555;
```

## Sequence: gating one content-and-owner-eligible spec (per scan cycle)

```mermaid
sequenceDiagram
  participant D as discoverBacklog
  participant M as Intake marker on base branch
  participant G as DependencyGate
  participant R as BlockerResolver
  participant GH as GitHub issue graph
  participant W as WAITING group
  participant P as pickEligible

  D->>M: read Source-Ref for spec «slug»
  alt no Source-Ref - not intake-originated
    D->>P: eligible - deps never apply
  else Source-Ref present
    D->>G: decide «slug», issue ref
    G->>R: open blockers for issue ref
    alt cached this scan
      R-->>G: cached blocker set
    else not cached
      R->>GH: fetch blocked-by relations + their states
      alt fetch ok
        GH-->>R: blocker issues + open or closed
        R-->>G: open blockers only
      else unreachable or unresolvable
        R-->>G: indeterminate
      end
    end
    alt no open blockers
      G-->>D: build
      D->>P: eligible
    else open blockers remain
      G->>W: wait - blocked by «issues»
      G-->>D: skip this cycle - warn once per state change
    else indeterminate
      G->>W: wait - indeterminate, fail closed
      G-->>D: skip this cycle
    else cycle detected among blockers
      G->>W: error - dependency cycle «members»
      G-->>D: skip this cycle
    end
  end
```

## Sequence: intake claim deferral

```mermaid
sequenceDiagram
  participant O as Operator or engineer session
  participant C as claim
  participant L as ledger + queue
  participant R as BlockerResolver
  participant GH as GitHub issue graph

  O->>C: claim next idea
  C->>L: pending entries, oldest first
  loop each pending entry in order
    C->>R: open blockers for entry sourceRef
    R->>GH: relations + states
    alt no open blockers
      C-->>O: claim entry - carry sourceRef
    else blocked or indeterminate
      Note over C,L: entry stays pending - deferred, not dropped
    end
  end
  alt queue had entries but all blocked
    C-->>O: all-blocked report - each entry + its blockers
  else queue empty
    C-->>O: empty
  end
```

## Legend

- **DependencyGate** — new decision unit in the `discoverBacklog` gauntlet, running **after**
  the owner gate (cheapest-first: content filters, then ownership, then a network-touching
  dependency check on the survivors). Skip is per-cycle, never a drop.
- **BlockerResolver** — the single seam both the daemon gate and intake claim use to answer
  "which open issues block this issue ref?" over GitHub's native blocked-by relations. One
  implementation, one cache policy, one indeterminate semantics; architecture-review ratifies
  its API surface (GraphQL vs REST) and cache scope.
- **WAITING group** — new dashboard/status bucket alongside HALTED / IN-PROGRESS / ELIGIBLE /
  PROCESSED (closes the #208 invisibility class for this gate). Requires `discoverBacklog` to
  emit skipped-with-reason items rather than only logging them.
- **fail closed** — indeterminate blocker state (GitHub unreachable, ref unresolvable) waits
  visibly instead of building (PRD FR-7); deliberate inversion of the owner-gate's fail-open.
- **migration command** — one-time, operator-confirmed, idempotent/additive prose→link pass
  (PRD FR-10/11); after it runs, native relations are the only recognized declaration form.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial feature diagram | Created during DECIDE for dependency-ordered intake and dispatch (#229) |
