# Components and sequences: Dispatch-first daemon maintenance

**Last updated:** 2026-10-14
**Governing ADR:** adr-2026-10-14-dispatch-first-daemon-maintenance
**Scope:** The target startup and per-tick scheduling of daemon maintenance for
jstoup111/ai-conductor#1174. Feature: `daemon-reconciliation-delays-first-feature-dispatc`.
Covers the dispatcher in `engine/daemon.ts`, the `DaemonMaintenance` scheduler, the startup
dashboard wiring, the best-effort reconcilers, the CI-fix and autoresolve repair sessions, and
phase-duration telemetry on the existing `ConductorEvent` spine. Discovery internals and the
safety checks are shown only to mark that they are unchanged and stay on the dispatch path.

## Component diagram

```mermaid
graph TD
  subgraph path["Dispatch path (foreground, before first claim)"]
    gates["Gates: pause, build auth, gh version floor (unchanged)"]
    refresh["Startup origin refresh: fetch and fast-forward root (kept, timed)"]
    discovery["Backlog discovery: processed, shipped-record, parked dedup (unchanged)"]
    pick["pickEligible: halted and parked checks (unchanged)"]
    stale["Throttled stale-engine check (unchanged)"]
    guarded["guardedDispatch: park re-check, then claim (unchanged)"]
    gates --> refresh --> discovery --> pick --> stale --> guarded
  end

  guarded --> pool["Worker pool (width = daemon_concurrency)"]
  guarded -->|"after first claim attempt"| sched["DaemonMaintenance scheduler"]

  subgraph bg["Background maintenance job (single-flight, runs at any pool width)"]
    dash["Startup dashboard (first run only; no fetch; informational parked classification)"]
    rekick["Rekick and consumeResumeAuthorizations"]
    haltpr["reconcileHaltPrs (gains isFeatureInFlight guard)"]
    parked["reconcileParkedFeatures"]
    fp["Parked input fingerprint (in-process memo)"]
    scratch["sweepProviderScratch"]
    labels["sweepMergeableLabels (labels; queues repairs, never awaits one)"]
    dash --> rekick --> haltpr --> parked --> scratch --> labels
    parked --> fp
  end

  sched --> bg
  labels -->|"queue every eligible repair"| repairQ["Repair request queue: CI-fix, autoresolve (priority band, then oldest PR)"]
  repairQ -->|"free slots go to repairs before new features"| pool
  inflight["In-flight slug set"] -.-> haltpr
  inflight -.-> parked
  inflight -.-> labels
  pool -.-> inflight

  path --> spine["ConductorEvent spine: daemon_maintenance_phase (new), daemon_backlog_snapshot (existing)"]
  bg --> spine
  spine --> ledger[".daemon/events.jsonl via EventPersister"]
```

## Sequence: daemon startup to first dispatch

```mermaid
sequenceDiagram
  participant D as Dispatcher
  participant G as Gates
  participant R as Root checkout
  participant W as Work source
  participant P as Worker pool
  participant M as Maintenance scheduler
  participant B as Background maintenance job
  participant S as ConductorEvent spine
  D->>G: pause, auth, gh-version checks
  G-->>D: open
  D->>R: fetch and fast-forward root
  R-->>D: base SHA
  D->>S: daemon_maintenance_phase(startup-refresh, durationMs)
  D->>W: discover backlog (processed, shipped, parked dedup)
  W-->>D: eligible items
  D->>S: daemon_backlog_snapshot(pollDurationMs)
  D->>D: pickEligible (halted, parked)
  D->>P: guardedDispatch(«slug») after park re-check
  activate P
  D->>M: start background maintenance (single-flight)
  M->>B: run
  activate B
  B->>B: dashboard (first run), then rekick and resume authorizations
  B->>B: halt-PR, parked, scratch, label sweeps (skip in-flight slugs)
  B->>S: daemon_maintenance_phase per phase (durationMs, outcome)
  alt PRs need CI-fix or autoresolve
    B->>D: queue repair requests (one per PR, uncapped per sweep)
    Note over D,P: next fill pass gives free slots to repairs before new features
    D->>P: run repair with reserved claim (unless paused or rate-limited)
  end
  deactivate B
```

## Sequence: repeat scan with unchanged parked inputs

```mermaid
sequenceDiagram
  participant M as Maintenance scheduler
  participant B as Background maintenance job
  participant F as Parked input fingerprint
  participant G as Git and park markers
  participant S as ConductorEvent spine
  M->>B: periodic sweep (idle or busy poll)
  B->>G: worktree list, for-each-ref, park markers, shipped listing
  G-->>B: inputs
  B->>F: compare fingerprint of inputs
  alt fingerprint unchanged
    F-->>B: unchanged
    B->>S: daemon_maintenance_phase(parked, skipped-unchanged, durationMs)
  else changed or first run in this process
    F-->>B: changed
    B->>G: per-candidate merge evidence and actions
    B->>F: store new fingerprint
    B->>S: daemon_maintenance_phase(parked, completed, durationMs)
  end
```

## Legend

- **Dispatch path:** the only work allowed between scan start and the first claim. Each of its
  safety checks is unchanged. The startup origin refresh stays on this path so discovery's
  shipped-record dedup sees merges that landed while the daemon was down.
- **Background maintenance job:** at most one runs at a time, at any pool width. It starts
  after the first claim attempt and keeps each reconciler's existing never-throw contract. Every
  mutating reconciler skips in-flight slugs.
- **Repair request queue:** CI-fix and autoresolve provider sessions no longer run inline inside
  the label sweep. Every eligible repair is queued, at most one per pull request. The dispatcher
  gives free slots to repairs before new features, ordered by priority band and then oldest pull
  request. Each running repair holds a reserved claim, so `daemon_concurrency` bounds repairs
  too. Pause and rate-limit episodes block repair claims.
- **Parked input fingerprint:** an in-process memo, never a sidecar file. The first run in each
  daemon process always does the full reconcile.
- **`daemon_maintenance_phase`:** a new `ConductorEvent` variant carrying `phase`, `durationMs`,
  and `outcome`. It extends the one spine; no new channel is added.
- `«slug»` marks a variable value.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-14 | Initial generation | #1174 dispatch-first maintenance design |
