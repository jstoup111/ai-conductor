# Complexity: Engine updates reach dispatched features without a full daemon drain

Tier: L

## Rationale

- Introduces a new process boundary: the feature executor moves from in-process
  (`createInProcessFeatureExecutor`) to a child process launched from a pinned
  `dist-versions/<id>/`, so dispatcher and executor may run different engine versions.
- Requires a cross-version, serialized WorkOrder contract and a dispatcher↔executor channel for
  dispatcher-owned services (rate-limit coordinator, claims, live-boundary attribution, event
  attribution).
- Amends approved ADRs: adr-2026-08-27 D1 (in-process v1), D2 (WorkOrder carries no engine
  identity) and D5 (drain-then-act for stale-engine), and interacts with adr-2026-07-07
  single-generation, adr-2026-07-04 versioned engine store GC, and adr-2026-10-14 maintenance.
- Spans several subsystems: dispatch, engine store GC, cadence rebuild, per-feature telemetry on
  the event spine, and `daemon status` rendering.

Per tier rules: architecture-diagram, full architecture-review, conflict-check, coherence-check and
plan-review all apply. Technical track — no PRD.
