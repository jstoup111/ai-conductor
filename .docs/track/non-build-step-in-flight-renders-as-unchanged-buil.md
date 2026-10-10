# Track: Non-build step in flight renders as unchanged build progress

Track: technical

Scope boundary: Close the remaining gap in #2806's desired outcomes on current main. (1) While any
lifecycle step other than `build` is still executing — serial steps such as `test_suite` and
`build_review`, and each member of the built-in `validation` group — the daemon log periodically
prints a line naming that step and its elapsed time. (2) `conduct daemon status` lists, for a
running daemon, each feature's in-flight steps by their own names with elapsed time, derived from
the feature's persisted `step_started` / terminal events. Excluded: config-declared `parallel:`
groups (they report under their group name today and are not lifecycle steps), OTel export of the
new heartbeat, the inline terminal renderer, any new config key (the interval and the off switch
reuse `build_progress.heartbeat_minutes` / `build_progress.enabled`), and any change to
`BuildProgressWatcher` or the `build_progress` line.

Re-verified against main e6b56fe3da before scoping: two of the issue's three outcomes are already
met on main and are only regression-pinned here. The build watcher is constructed only for `build`
and stopped in the attempt's `finally` (`src/conductor/src/engine/conductor.ts:9488-9509`, `:9775`);
the 2026-10-08/09 `.daemon/daemon.log.1` shows no `▶ build N/M` line between `build ✓ done` and the
`test_suite` outcome. Validation-group members emit their own `step_started` on admission since
#2514 (`conductor.ts:7328-7336`), and the 2026-08-23 `[wiring_check, test_suite]` group no longer
exists (`test_suite` is a serial step, `src/conductor/src/engine/steps.ts:173`). Still missing:
nothing is printed while a non-build step runs (that log shows ~10-minute `test_suite` runs with no
line between `▶ test_suite` and the result), and `daemon status` shows only the repository's last
`daemon.log` line (`src/conductor/src/engine/daemon-observe-cli.ts:283-287`).

Internal operator observability with no product requirements; acceptance criteria live in stories
(intake jstoup111/ai-conductor#2806).

## Approaches weighed

- **A: Filer hypothesis 1, stop or re-attribute the build watcher.** It is already stopped when
  `build` settles on main. On its own it leaves non-build steps silent. Rejected as sufficient;
  kept only as a regression pin.
- **B: Filer hypothesis 2, a step-start event per group member.** #2514 delivered this. It names
  members at start but says nothing while they run. Already done.
- **C (chosen): a `step_in_flight` heartbeat event plus an event-derived in-flight view in
  `daemon status`.** A new `ConductorEvent` variant is emitted every
  `build_progress.heartbeat_minutes` by a per-attempt ticker. The ticker starts at the existing
  per-step dispatch seam (non-build steps) and at the validation-group member admission seam, and
  stops in the same `finally` / settle paths that already end the build watcher. Status folds each
  in-progress feature's merged event ledger into its open steps. Event spine: this extends the
  union, so no channel and no ADR are needed. Status reads the existing ledger rather than a new
  sidecar. Est. ~half day. Impact: the operator can tell a running step from a hang without
  reading sidecars.
- **D: status-only (no log heartbeat).** Smaller, but the daemon line still goes silent for the
  length of the step, which fails the first desired outcome. Rejected.
