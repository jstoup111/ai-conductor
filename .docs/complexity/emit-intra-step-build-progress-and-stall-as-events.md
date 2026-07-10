# Complexity: emit-intra-step-build-progress-and-stall-as-events

Tier: M

## Rationale

- **Surfaces touched (breadth, drives M):** new `ConductorEvent` union members
  (`types/events.ts`), a new engine-side progress watcher module, conductor build-step
  wiring, and four subscriber render paths (daemon-log `renderDaemonEvent`, TTY
  `createRenderer`, `OtelVisualizer`, `EventPersister`) plus a discoverable `ui_renderer`
  plugin per the Wave C ruling.
- **State machine (drives M):** the watcher is a small stall/progress state machine
  (advancing / idle / no-progress thresholds) with timer lifecycle (start on build step
  entry, stop/unref on step resolution) that must never leak intervals or block `emit()`.
- **Not L:** no new external integration (OTel exporter already exists), no auth/identity
  work, no persistence schema change (`task-status.json` is read-only input, already
  engine-owned per adr-2026-07-05-engine-owned-task-status), no cross-repo coupling, no
  data migration.
- **Not S:** more than a single-file change; introduces new event contracts consumed by
  multiple independent subscribers; estimated 8–12 stories.

Per HARNESS tiering: M ⇒ architecture-diagram + lightweight architecture-review +
conflict-check are REQUIRED (not skipped).
