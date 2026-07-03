# ADR: DependencyGate placement and the backlog waiting-items channel

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #229

## Context

PRD FR-4/FR-6: the daemon must skip specs with open blockers *and* surface them in a WAITING
dashboard group. Today `discoverBacklog` (daemon-backlog.ts) is a per-file gauntlet that
`continue`s ineligible specs — a skipped spec never becomes a `BacklogItem`, leaves only a
warn-once log line, and is invisible to `scanInheritedState`/`renderDashboard`
(daemon-dashboard.ts). That is exactly the owner-gate invisibility gap (#208). Two decisions:
where the gate sits in the gauntlet, and how skip information reaches the dashboard.

## Options Considered

### Option A: Gate last in the gauntlet; widen the discovery result to carry waiting items
`discoverBacklog` returns `{ items, waiting }` (or equivalent): `items` = dispatchable
`BacklogItem`s as today; `waiting` = specs that passed content + owner filters but have open
blockers, each with a reason (`blocked-by: [refs]` / `indeterminate` / `cycle`). Dashboard adds
a WAITING group from that channel; `pickEligible` consumes `items` only.
- **Pros:** Skip data flows through the same call graph the dashboard already uses
  (`deps.discover()`); no second scan; reasons are structured, not log strings; establishes the
  channel #208 can later reuse for owner-gate skips.
- **Cons:** Return-shape change touches `discoverBacklog`'s callers (`localWorkSource`,
  dashboard, tests).

### Option B: Side-channel file (e.g. a waiting-state file the dashboard reads)
- **Pros:** No signature change.
- **Cons:** Second source of truth that can go stale between scan and render; racy with
  concurrent scans; the exact pattern (`.daemon/warned/`) that produced the #208 invisibility.

### Option C: Gate inside `pickEligible` (daemon.ts) instead of `discoverBacklog`
- **Pros:** Backlog stays untouched.
- **Cons:** `pickEligible` is a pure in-memory selector today; putting a network call there
  runs it on every pick (not once per scan), and dashboard code doesn't see pick-time state —
  the invisibility gap survives.

## Decision

**Option A.** The `DependencyGate` runs **last** in the `discoverBacklog` gauntlet — after
content filters and the owner gate — so the network-touching check runs only on specs that are
otherwise dispatchable (cheapest-first ordering, matching how the owner gate was slotted after
content filters). The discovery result is widened to carry `waiting` entries
`{ slug, sourceRef, reason, blockers[] }`; `daemon-dashboard.ts` renders them as a WAITING
group alongside HALTED / IN-PROGRESS / ELIGIBLE / PROCESSED (bucket precedence: a waiting spec
appears only in WAITING). Specs without a `Source-Ref` bypass the gate entirely (PRD FR-3).
Announcement is warn-once **per state change** (blocker set / reason transition), not
once-per-slug-forever, so an unblock→reblock is re-announced; continuous visibility lives in
the dashboard, not the log.

Owner-gate skips are **not** migrated into the channel in this feature (scope: #208), but the
channel is deliberately shaped so #208 becomes "add a second reason kind."

## Consequences

### Positive
- Blocked work visible in exactly one bucket, with machine-readable reasons (PRD FR-6).
- Establishes the structured skip channel #208 needs; no new files or state directories.
- Gate ordering keeps GitHub calls off specs that would be filtered anyway.

### Negative
- `discoverBacklog` signature change ripples to `localWorkSource`, dashboard, and their tests
  in one coordinated change.
- Dashboard gains a group whose content depends on network state; on indeterminate scans the
  WAITING group is the honest-but-noisy surface.

### Follow-up Actions
- [ ] Widen discovery result with `waiting` entries + reasons
- [ ] WAITING group in `scanInheritedState`/`renderDashboard` (+ `--status`)
- [ ] Warn-once keyed on (slug, reason/blocker-set) state change
