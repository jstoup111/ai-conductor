# Architecture Review: Daemon startup dashboard is unreadable at real repo scale (#1332)
**Date:** 2026-10-24
**Mode:** Lightweight (Tier M) — Technical Feasibility and Architectural Alignment only
**Inputs reviewed:** explore output and technical intent (`.docs/track/daemon-startup-dashboard-is-unreadable-at-real-rep.md`), component diagram (`.docs/architecture/daemon-startup-dashboard-is-unreadable-at-real-rep.md`), and operator-confirmed design decisions from 2026-10-24
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Intent item | Assessment | Confidence / basis |
|---|---|---|
| Attention line, actionable-first order, compact console mode in `renderDashboard` | Pure string rendering inside an existing exported function. No new dependency. | 95% verified (`daemon-dashboard.ts` `renderDashboard`) |
| Full render kept for `daemon.log`; compact render on console | The startup call site already renders twice: one copy for the persisted log, one for the console (`writeDashboard(persisted, console)` in `daemon-cli.ts`). Each copy only needs a different render mode. | 95% verified |
| `--all` / `--completed` expands the console render | Both flags already parse to `showCompleted` (`daemon-command.ts`) and reach the startup dashboard. The change widens an existing flag's meaning; it adds no new flag. | 90% verified |
| Restore WAITING, GATED, BLOCKED at startup | Today's startup `discover()` hands `scanInheritedState` a bare `BacklogItem[]` (`daemon-cli.ts` `createStartupDashboard`). The bare-array branch then sets `waiting = []` and `gated = []` (`daemon-dashboard.ts` `scanInheritedState`), so WAITING never renders at startup and GATED always reads `0`. `localWorkSource` already holds `latestStates.{waiting,blocked,gated}` from the same pass. An optional accessor can expose them without a second discovery pass. | 90% verified |
| BLOCKED partition with one-bucket precedence | `BlockedSpecItem` `{slug, reason, remedy}` already exists (`daemon-backlog.ts`), and discovery already excludes parked slugs from it. The new partition is filtered with the same precedence sets the renderer already builds. | 90% verified |
| Row budget = `process.stdout.columns` on a TTY, else 80 | The repo has no prior use of `stdout.columns`, but it is standard Node. A non-TTY console, or a test, falls back to 80. The budget is resolved once per render. | 85% inferred |

**Stack / data / prerequisites:** no new package, schema, persisted format, migration, or external
call. **Worktree isolation:** no port, database, or shared file is added. **Performance:**
O(rows), negligible.

## Alignment

- **Event spine:** this is not a new observation channel. The dashboard keeps reading the
  existing in-process discovery result, and BLOCKED reaches it through the same `WorkSource` pass
  that already writes `.daemon/blocked.json`. No sidecar, poller, or new file is added.
- **Pattern basis (WorkSource optional accessor).** *Role:* the shape for exposing per-pass
  discovery state without changing `discover()`'s return contract. *Material traits:* the
  accessor is an optional method on `WorkSource`; it reads the adapter's existing per-pass
  `latestStates`; it returns `undefined` before the first pass; it never triggers discovery.
  *Why it applies:* `snapshot?` already exposes `latestStates` counts this way for
  `getDiscoverySnapshot`. *Allowed variation:* the method name and its parked-filter placement.
  *Hints:* `WorkSource`, `localWorkSource`, `latestStates`, `snapshot` in
  `src/engine/daemon-work-source.ts`.
- **Governing ADRs, reused:**
  - `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` D1/D3. BLOCKED is its own channel,
    and startup rendering was deferred to #1332. This design delivers that deferral and leaves
    the channel unchanged.
  - `adr-2026-07-03-dependency-gate-backlog-waiting-channel` D2. A waiting spec appears only in
    WAITING. Unchanged.
  - `adr-2026-07-04-operator-park-marker` D5. **Amended** (see below).
  - `adr-2026-07-03-owner-gate-gated-channel` D3. **Amended** (see below).
- **Conflicts resolved (operator-approved 2026-10-24).** Two ADR clauses tied *display order* to
  group identity: PARKED "strictly first", and GATED "after WAITING". Both got additive amendment
  notes. Bucket precedence (the single group a slug lands in) remains binding. Display order now
  puts groups that need action first. No new ADR: the display order of a text render is not one
  of the §7 structural decisions.
- **Diagram accuracy:** the component diagram for this stem reflects the design.
- **Security:** no new input surface. Rendered text comes from existing local sources.

## Domain Integrity

Skipped (lightweight mode). Noted for BUILD: model the render mode as a closed union
(`'full' | 'compact'`), not a boolean.

## Wiring Surface

| New / changed surface | Production caller (design-time) |
|---|---|
| `WorkSource` optional partitions accessor (`localWorkSource`) | Called by `createStartupDashboard`'s startup `discover()` closure in `daemon-cli.ts`, through the `workSource` the daemon already constructs |
| Widened startup `discover()` result `{ items, waiting, blocked, gated }` | Consumed by the existing `scanInheritedState` call in `createStartupDashboard` |
| `InheritedState.blocked` partition | Filled by `scanInheritedState`, read by `renderDashboard` |
| `renderDashboard` render mode + row budget options | The existing `options.writeDashboard(...)` call: full for the persisted copy, compact (or full when `showCompleted`) for the console copy |

Early overlap scan (advisory): `daemon-cli.ts` overlaps `spec/daemon-log-flooded-with-raw-claude-stream-json-and`
and `origin/spec/self-host-phase6-wiring`. `daemon-dashboard.ts` overlaps
`origin/spec/daemon-self-host-guardrails`. All three are long-lived spec branches, not active builds
of this surface. Not blocking.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Existing acceptance tests and runbooks assert on dashboard group order or full-row content | Technical | High | Medium | The persisted full render keeps every row and group header. Tests that pin order to PARKED-first are updated with the amended ADR as their reference. |
| A width read once at startup goes stale when a phone later attaches to the tmux pane | Technical | Medium | Low | Accepted. `--all` and `daemon.log` give full detail. The budget falls back to 80 off a TTY. |
| A slug longer than a narrow terminal still wraps | Technical | Low | Low | Slugs are at most 50 characters and are never clipped (operator decision). Only free text is clipped. |
| Precedence regression when adding BLOCKED (a slug lands in two groups) | Data | Low | Medium | A one-bucket invariant test runs across all partitions. |

## ADRs Created

None. Two APPROVED ADRs were amended in place with additive notes:
`adr-2026-07-04-operator-park-marker` (D5) and `adr-2026-07-03-owner-gate-gated-channel` (D3).

## Conditions

1. The one-bucket invariant is tested across every group, including the new BLOCKED and the
   restored WAITING and GATED at startup.
2. The persisted `daemon.log` render stays full: every group header and every row. Runbooks keep
   working.
3. The amended ADRs (`adr-2026-07-04-operator-park-marker`, `adr-2026-07-03-owner-gate-gated-channel`)
   join the coherence obligation table for this spec.
