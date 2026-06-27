# Components (L3): Engineer Intake Subsystem — Phase 9.3b

**Last updated:** 2026-06-27
**Scope:** `src/conductor/src/engine/engineer/` intake path after 9.3b. Shows the new
github-issues source, async inbox queue, durable ledger, and realized write-back — and the
deliberately **untouched** daemon lock boundary.

## Diagram

```mermaid
graph TD
  subgraph ext["External"]
    GH["GitHub<br/>(issues, comments, labels)"]:::ext
    REG["9.2 Registry<br/>(repo paths)"]:::existing
  end

  subgraph intake["engineer/intake/ (9.3b)"]
    SRC["IntakeSource (interface)<br/>poll(): Envelope[]"]:::iface
    GHA["github-issues adapter<br/>(implements IntakeSource + report)"]:::new
    CSA["claude-session adapter<br/>(sync; report = no-op)"]:::existing
    PORT["IntakePort (interface)<br/>report(sourceRef,status,meta?)"]:::iface
    QIF["IntakeQueue (interface)<br/>enqueue/claim/ack/release"]:::iface
    FQ["file-backed queue<br/>(.engineer/inbox/)"]:::new
    LED["intake ledger<br/>(.engineer/ledger.json)<br/>SOLE dedup authority"]:::new
    DQ["distributed queue backend<br/>(FUTURE — swap impl)"]:::future
  end

  subgraph core["engineer core"]
    LOOP["engineer loop<br/>(route → DECIDE → spec PR)"]:::existing
  end

  subgraph daemon["daemon (UNTOUCHED by 9.3b)"]
    LOCK["daemon-lock.ts<br/>O_EXCL pidfile (.daemon/)<br/>FR-20 single-winner"]:::frozen
  end

  REG --> GHA
  GHA -- "gh issue list --assignee @me" --> GH
  GHA -. implements .-> SRC
  GHA -. implements .-> PORT
  CSA -. implements .-> PORT
  SRC -- "Envelopes" --> FQ
  FQ -. implements .-> QIF
  DQ -. "future impl of" .-> QIF
  LED <-- "dedup / lifecycle" --> FQ
  QIF -- "claim oldest" --> LOOP
  LOOP -- "report(routed/done)" --> PORT
  GHA -- "comment + engineer:handled label" --> GH
  LOOP -. "owns its own atomic claim;<br/>NEVER imports" .-x LOCK

  classDef new fill:#cce5ff,stroke:#004085,stroke-width:2px;
  classDef iface fill:#e2e3ff,stroke:#383d7c,stroke-dasharray:4 2;
  classDef existing fill:#d4edda,stroke:#155724;
  classDef frozen fill:#f5c6cb,stroke:#721c24,stroke-width:2px;
  classDef future fill:#fff3cd,stroke:#856404,stroke-dasharray:5 3;
  classDef ext fill:#eeeeee,stroke:#555;
```

## Legend

- **Blue (new, 9.3b):** github-issues adapter, file-backed queue, durable ledger.
- **Dashed lilac (interface):** the seams the core depends on — `IntakeSource`, `IntakePort`,
  `IntakeQueue`. Loose coupling: core imports interfaces only.
- **Green (existing):** claude-session adapter, engineer loop, 9.2 registry — reused, minimally
  extended (loop gains poll-on-launch + report wiring; `report` signature widened with optional `meta`).
- **Red (frozen):** `daemon-lock.ts` / `O_EXCL` pidfile. **9.3b must not touch it.** The `⊗` edge
  marks that the queue's atomic claim is implemented with its *own* primitive and never imports the
  daemon lock (FR-20 untouched).
- **Yellow dashed (future):** distributed queue backend — a drop-in implementation of `IntakeQueue`
  for a future worker pool. Not built in 9.3b.

## Key invariants encoded

1. `engineer/intake/idempotency.ts` (9.3 in-memory guard) is **removed**; the ledger is the single
   dedup authority. (Not shown as a node — it no longer exists post-9.3b.)
2. `.engineer/` (intake) and `.daemon/` (build/liveness) are disjoint directories.
3. The github adapter is the only component that talks to GitHub (capture + write-back); the core
   speaks only to interfaces.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-27 | Initial generation | Phase 9.3b intake subsystem design |
