# Components + Sequences: Surface Owner-Gated Specs in Dashboard and Status

**Last updated:** 2026-07-03
**Scope:** How owner-gate skip decisions become first-class visible state: gated entries
returned from `discoverBacklog`, a GATED dashboard group (mirroring the WAITING pattern from
#246), a per-pass `.daemon/gated.json` snapshot read by `conduct-ts daemon status`, and a
warn-once GitHub write-back on the spec PR / Source-Ref issue. PRD:
`.docs/specs/2026-07-03-surface-owner-gated-specs-dashboard-status.md` (issue #208).

## Component View

```mermaid
graph TD
  subgraph daemon["daemon discovery (per scan pass)"]
    DB["discoverBacklog - per-spec gauntlet"]:::existing
    CF["content filters - plan, stories, processed"]:::existing
    OG["decideSpecGate - owner gate decision"]:::existing
    COLL["GatedCollector - slug, reason, remedy per skip"]:::new
    GW["global gate warnings - identity unresolved, no cutover"]:::existing
    PICK["pickEligible + dispatch"]:::existing
  end

  subgraph persist["persisted state"]
    SNAP["gated snapshot - whole-file atomic rewrite per pass"]:::new
    WARN["warn-once markers"]:::existing
  end

  subgraph dash["startup dashboard"]
    SCAN["scanInheritedState"]:::existing
    GATED["GATED group - reason + remedy per slug"]:::new
    WAITB["WAITING group - dependency-blocked"]:::existing
    REND["renderDashboard"]:::existing
  end

  subgraph observe["daemon status CLI"]
    STAT["runDaemonStatus - registry liveness sweep"]:::existing
    GREAD["gated snapshot reader - freshness label, unknown on missing"]:::new
  end

  subgraph writeback["gate write-back (advisory)"]
    ORCH["GateWriteback - once per still-gated spec"]:::new
    PRL["pr-labels seam - upsertComment, ensureLabel, addLabel"]:::existing
  end

  subgraph ext["External"]
    GH["GitHub - spec PR + Source-Ref issue"]:::ext
  end

  DB --> CF
  CF --> OG
  OG -- "build" --> PICK
  OG -- "skip: reason" --> COLL
  GW -- "repo-level warnings" --> COLL
  COLL -- "gated entries in scan result" --> SCAN
  COLL -- "rewrite each pass" --> SNAP
  COLL --> ORCH
  ORCH -- "dedup via marker comment" --> PRL
  PRL --> GH
  ORCH -.-> WARN
  SCAN --> GATED
  GATED --> REND
  WAITB --> REND
  STAT --> GREAD
  GREAD -- "read only, no re-scan" --> SNAP

  classDef new fill:#cce5ff,stroke:#004085,stroke-width:2px;
  classDef existing fill:#d4edda,stroke:#155724;
  classDef ext fill:#eeeeee,stroke:#555;
```

## Sequence: scan pass surfaces a gated spec

```mermaid
sequenceDiagram
  participant D as discoverBacklog
  participant OG as decideSpecGate
  participant C as GatedCollector
  participant S as gated snapshot
  participant W as GateWriteback
  participant GH as GitHub
  participant DASH as dashboard GATED group

  D->>OG: decide spec «slug»
  alt build - owned or grandfathered
    OG-->>D: build
  else skip - other-owner / unowned-post-cutover / unowned-indeterminate
    OG-->>C: gated «slug», reason, remedy hint
    C->>W: announce block for «slug»
    alt announcement already present on PR
      W->>GH: update marker comment in place
    else first announcement
      W->>GH: comment + label spec PR
      opt Source-Ref issue exists
        W->>GH: comment originating issue
      end
    end
    Note over W,GH: advisory - failure logged, never blocks the scan
  end
  D->>S: atomic whole-file rewrite - all gated entries + repo warnings + timestamp
  D-->>DASH: gated entries in scan result
  Note over S: entries absent this pass vanish - self-healing, no cleanup
```

## Sequence: phone-level status check

```mermaid
sequenceDiagram
  participant O as Operator
  participant CLI as daemon status
  participant S as gated snapshot
  O->>CLI: status
  CLI->>S: read snapshot for repo
  alt snapshot present
    S-->>CLI: gated entries + repo warnings + written-at
    CLI-->>O: liveness rows + GATED section with freshness age
  else missing or unreadable
    CLI-->>O: gated state unknown - daemon has not scanned / snapshot unreadable
  end
  Note over CLI: never re-scans repos, never touches GitHub
```

## Legend

- **GatedCollector** — the owner-gate skip path stops `continue`-dropping specs; each skip
  becomes a structured entry (slug, gate reason, remedy hint) carried in the scan result.
  Repo-level warnings (daemon identity unresolved, cutover unset) travel alongside as
  repo-scoped entries (FR-11).
- **GATED group** — new dashboard bucket beside HALTED / IN-PROGRESS / WAITING / ELIGIBLE /
  PROCESSED; a spec appears in exactly one bucket (FR-4). Mirrors the WAITING pattern
  introduced by dependency-ordered dispatch (#246).
- **gated snapshot** — single per-repo file rewritten atomically every scan pass; the ONLY
  input to the status CLI's gated section, keeping `daemon status` cheap (no re-scan, no
  network). Whole-file rewrite makes staleness self-healing (FR-7); its written-at timestamp
  is the freshness label (FR-6).
- **GateWriteback** — mirrors the needs-remediation escalation: hidden-marker comment
  edited in place (never duplicated, FR-10), plus a distinguishing label; all best-effort
  (FR-12).
- **existing vs new** — green nodes exist today (explore map: gate.ts, daemon-backlog.ts,
  daemon-dashboard.ts, daemon-observe-cli.ts, pr-labels.ts); blue nodes are this feature.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial feature diagram | Created during DECIDE for owner-gated spec visibility (#208) |
