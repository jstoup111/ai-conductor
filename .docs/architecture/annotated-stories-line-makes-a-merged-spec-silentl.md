# Components + Sequences: Blocked Merged Specs Are Visible, Never Skipped

**Last updated:** 2026-08-05
**Scope:** How a merged spec that cannot build becomes first-class visible state: a
token-first stories-reference resolver, a reordered per-plan gauntlet in `discoverBacklog`
that emits structured `blocked` entries after dedup, a `BLOCKED` dashboard group mirroring
the `GATED` pattern from #208, and a per-pass `.daemon/blocked.json` snapshot read by
`conduct-ts daemon status`. PRD:
`.docs/specs/annotated-stories-line-makes-a-merged-spec-silentl.md` (issue #1330).

## Component View

```mermaid
graph TD
  subgraph resolve["reference resolution (pure)"]
    RES["resolvePlanStoriesPath"]:::existing
    NORM["normalizeStoriesReference - backtick span, leading link, first token"]:::new
  end

  subgraph daemon["daemon discovery (per scan pass)"]
    DB["discoverBacklog - per-plan gauntlet"]:::existing
    DEDUP["dedup first - processed, shipped-by-stem, parked"]:::changed
    SREF["resolveStoriesRef - unresolvable vs missing"]:::changed
    VET["content vetting - approved, dep tree, coherence"]:::existing
    COLL["BlockedCollector - slug, reason, remedy per decline"]:::new
    WARN["warnOnce - existing skip log lines retained"]:::existing
    OG["decideSpecGate - owner gate"]:::existing
    PICK["pickEligible + dispatch"]:::existing
  end

  subgraph persist["persisted state"]
    SNAP["blocked snapshot - whole-file atomic rewrite per pass"]:::new
    GSNAP["gated snapshot"]:::existing
    WMARK["warn-once markers"]:::existing
  end

  subgraph dash["startup dashboard"]
    SCAN["scanInheritedState"]:::existing
    BGRP["BLOCKED group - reason + remedy per slug"]:::new
    GGRP["GATED group"]:::existing
    REND["renderDashboard - pinned precedence"]:::changed
  end

  subgraph observe["daemon status CLI"]
    STAT["runDaemonStatus - registry liveness sweep"]:::existing
    BREAD["blocked snapshot reader - freshness label, unknown on missing"]:::new
  end

  subgraph land["engineer land (authoring side)"]
    LAND["landSpec - stories reference must match selected artifact"]:::changed
  end

  NORM --> RES
  RES --> SREF
  RES --> LAND
  DB --> DEDUP
  DEDUP -- "already processed / shipped / parked" --> PICK
  DEDUP --> SREF
  SREF -- "resolves + present" --> VET
  SREF -- "unresolvable / target absent" --> COLL
  VET -- "passes" --> OG
  VET -- "not approved / no dep tree / no coherence" --> COLL
  COLL --> WARN
  WARN -.-> WMARK
  OG --> PICK
  COLL -- "blocked entries in scan result" --> SCAN
  COLL -- "rewrite each pass" --> SNAP
  SCAN --> BGRP
  SCAN --> GGRP
  BGRP --> REND
  GGRP --> REND
  STAT --> BREAD
  BREAD --> SNAP
  GSNAP -.-> STAT

  classDef new fill:#d5f5d5,stroke:#2d7a2d
  classDef changed fill:#fff3cd,stroke:#a07800
  classDef existing fill:#eeeeee,stroke:#888888
  classDef ext fill:#e6e6fa,stroke:#6a5acd
```

## Sequence: a merged spec with an annotated stories line

```mermaid
sequenceDiagram
  participant D as discoverBacklog
  participant R as resolvePlanStoriesPath
  participant T as base-branch tree
  participant P as pickEligible

  D->>T: readFile(.docs/plans/<slug>.md)
  T-->>D: plan content with "**Stories:** `.docs/stories/x.md` (11 stories)"
  D->>D: processed? shipped-by-stem? parked?  (no)
  D->>R: resolve(planRepoPath, planContent)
  R->>R: backtick span wins -> ".docs/stories/x.md"
  R-->>D: ".docs/stories/x.md"
  D->>T: readFile(.docs/stories/x.md)
  T-->>D: approved stories
  D->>D: content vetting passes
  D->>P: eligible
```

## Sequence: a merged spec whose stories reference cannot resolve

```mermaid
sequenceDiagram
  participant D as discoverBacklog
  participant R as resolvePlanStoriesPath
  participant C as BlockedCollector
  participant W as warnOnce
  participant S as .daemon/blocked.json
  participant CLI as conduct-ts daemon status

  D->>D: processed? shipped-by-stem? parked?  (no)
  D->>R: resolve(planRepoPath, planContent)
  R-->>D: null
  D->>C: block(slug, "unresolvable-stories-ref", remedy)
  C->>W: log once per slug
  D->>S: atomic whole-file rewrite of this pass's blocked set
  CLI->>S: read (no git, no network)
  S-->>CLI: entries + writtenAt
  CLI-->>CLI: render BLOCKED section with freshness age
```

## Key Decisions Reflected Here

- **Dedup precedes classification.** Processed / shipped-by-stem / parked checks move ahead of
  stories resolution so that legacy plans (82 in this repository) are never reported as
  blocked. Content-hash shipped dedup is unavailable when stories cannot resolve, so
  stem-match plus processed markers are the dedup available on that path — see
  `adr-2026-08-05-blocked-classification-after-dedup`.
- **`BLOCKED` is a distinct state, not `HALTED`.** HALTED is worktree-marker-derived and drives
  rehabilitation, escalation, re-kick, and park reconciliation. A blocked spec has no
  worktree and its remedy is on the default branch — see
  `adr-2026-08-05-blocked-is-a-distinct-state-from-halted`.
- **Snapshot read model.** `daemon status` reads a per-pass atomic snapshot rather than
  re-scanning repositories, exactly as `adr-2026-07-03-gated-snapshot-status-read-model`
  established for gated work.
- **Token-first normalization.** The resolver normalizes the reference before validating it,
  rather than special-casing a trailing parenthetical — see
  `adr-2026-08-05-token-first-stories-reference-normalization`.
