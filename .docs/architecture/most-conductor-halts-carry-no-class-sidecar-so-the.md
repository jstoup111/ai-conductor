# Architecture: Total HALT classification with an explicit legacy boundary

**Last updated:** 2026-07-28
**Scope:** Conductor HALT writers, daemon startup compatibility migration, and re-kick classification policy for #1077.

## Current state

```mermaid
flowchart LR
  subgraph engine["Conductor engine"]
    RAW["28 direct production HALT writes<br/>25 conductor plus 3 other funnels"]
    OPT["Shared writer<br/>class argument optional"]
  end

  subgraph state["Per-worktree pipeline state"]
    HALT["HALT body"]
    CLASS["HALT.class<br/>optional"]
  end

  subgraph sweep["Main-advance re-kick sweep"]
    READ["readHaltClass"]
    HUMAN{"needs-human?"}
    CLEAR["clear HALT and re-kick"]
    SKIP["leave HALT for operator"]
  end

  RAW --> HALT
  OPT --> HALT
  OPT -.->|"only when supplied"| CLASS
  HALT --> READ
  CLASS -.-> READ
  READ --> HUMAN
  HUMAN -->|"yes"| SKIP
  HUMAN -->|"mechanical or unclassified"| CLEAR
```

The unsafe seam is absence-as-compatibility: a bypassed writer, a failed class write, and a genuine pre-classification legacy marker all read as `unclassified`, so the sweep cannot distinguish corruption from history and re-kicks all three.

## Target component view

```mermaid
flowchart TB
  subgraph writers["Engine-owned HALT producers"]
    COND["conductor.ts halt funnels<br/>writer batches in Tasks 8-16"]
    REBASE["rebase.ts and self-host gate funnels"]
    OTHER["task-progress, daemon-runner,<br/>and build-auth preflight"]
  end

  subgraph marker["halt-marker module"]
    API["halt-marker.ts<br/>writeHaltMarker root, body, class<br/>class is required"]
    TYPES["Writable classes<br/>needs-human or mechanical"]
    READER["readHaltDisposition"]
  end

  subgraph guard["Deterministic authoring guard"]
    STATIC["check_halt_writers.sh<br/>reject direct production HALT writes"]
    TYPECHECK["TypeScript<br/>reject omitted class"]
  end

  subgraph migration["Daemon startup under project lock"]
    START["daemon-cli.ts<br/>runDaemonMode"]
    MIG["halt-class-migration.ts<br/>legacy compatibility scan"]
    WATER["daemon migration watermark<br/>written after scan"]
  end

  subgraph disk["Per-worktree pipeline state"]
    HALT["HALT body"]
    CLASS["HALT.class<br/>needs-human, mechanical, or legacy"]
  end

  subgraph policy["Re-kick policy"]
    DECIDE{"Disposition"}
    WAIT["skip and retain HALT"]
    RETRY["clear and re-kick"]
  end

  COND --> API
  REBASE --> API
  OTHER --> API
  TYPES --> API
  TYPECHECK -.-> API
  STATIC -.-> writers
  API --> HALT
  API --> CLASS
  START --> MIG
  MIG -->|"stamp only pre-boundary classless HALTs as legacy"| CLASS
  MIG --> WATER
  HALT --> READER
  CLASS --> READER
  READER --> DECIDE
  DECIDE -->|"needs-human"| WAIT
  DECIDE -->|"mechanical"| RETRY
  DECIDE -->|"legacy compatibility"| RETRY
  DECIDE -->|"missing, unreadable, or invalid"| WAIT
```

`legacy` is a read disposition and migration stamp, not a class new halt writers may select. New writers are restricted to `needs-human` or `mechanical`, so compatibility cannot become a permanent escape hatch.

## Startup and re-kick sequence

```mermaid
sequenceDiagram
  participant D as Daemon startup
  participant L as Project daemon lock
  participant M as Legacy migration
  participant W as Worktree state
  participant S as Re-kick sweep
  participant O as Operator

  D->>L: acquire exclusive project lock
  L-->>D: ownership confirmed
  D->>M: run migration before dispatch or re-kick
  M->>M: check migration watermark
  alt first run after upgrade
    M->>W: list live HALTs lacking HALT.class
    loop each pre-boundary classless HALT
      M->>W: atomically stamp legacy
    end
    M->>M: atomically write completed watermark
  else migration already completed
    M-->>D: no-op
  end
  D->>S: continue normal daemon loop
  S->>W: read HALT disposition
  alt needs-human or unclassified
    S-->>O: retain HALT and log operator-required reason
  else mechanical or explicitly legacy
    S->>W: clear HALT and class together
    S->>S: resume through canonical re-kick path
  end
```

## Structural decisions represented

- The compatibility boundary is a one-time daemon migration under the already-held project lock. It stamps only HALTs that existed before the new writer contract and records completion durably before normal work begins.
- Migration is idempotent. A crash before the completion watermark causes the next exclusively locked startup to repeat the scan; no dispatch can create a new HALT between scan and watermark.
- A per-worktree stamp uses `legacy` explicitly. Absence never means legacy after migration.
- Failed legacy stamping is logged and remains fail-closed as `unclassified`; compatibility is best-effort, safety is not.
- The shared writer requires a class, while a static integrity check rejects direct production writes to `HALT`. These two mechanical gates enforce totality at the point of authoring.
- The two-file write cannot be fully atomic. Writing the HALT body without a readable class therefore degrades to operator-required, never automatic re-kick; a stale class must be cleared before a new body is written and when a HALT is cleared.

## Legend

- Solid arrows are runtime calls or persisted writes.
- Dashed arrows are build-time enforcement.
- `legacy` preserves only the pre-upgrade behavior of already-existing classless HALTs.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-07-28 | Initial feature architecture | DECIDE for jstoup111/ai-conductor#1077 |
| 2026-07-28 | Added plan-level modules, writer batches, and integrity guard | Plan-update mode after the 17-task implementation plan |
