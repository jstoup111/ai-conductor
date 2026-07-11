# ADR: Intra-step build progress + stall as first-class ConductorEvents

**Date:** 2026-07-10
**Status:** APPROVED
**Deciders:** Operator (design direction pre-declared in issue #347; ratified at spec-PR merge)

## Context

In daemon/auto mode a long build step is a black box: the conductor blocks on
`await stepRunner.run('build', …)` (`conductor.ts:1451`) and emits nothing between
`step_started` and the step's terminal event. The only stall machinery is post-hoc —
after a completion-gate miss, `countResolvedTasks` deltas feed a circuit breaker that
emits `build_stall` (`conductor.ts:1762`) — and that event is rendered by **no**
subscriber today (TTY `createRenderer` and daemon `renderDaemonEvent` both drop it;
`OtelVisualizer` never subscribes). Operators cannot distinguish a healthy-long build
(2026-07-05: 56 silent minutes at 20/21 tasks) from a wedged one without opening the
worktree. Issue #280 (daemon halts progressing builds) needs exactly this signal.

Constraints (verified against source, 2026-07-10):
- The progress ground truth already exists: `.pipeline/task-status.json`, engine-owned
  (adr-2026-07-05-engine-owned-task-status), flipped live by `task-cli` from inside the
  build worktree; `countResolvedTasks(this.projectRoot)` already reads it — the
  conductor's `projectRoot` is the correct root for the watcher too.
- There is **no fs.watch infrastructure** anywhere in the engine; the only follow
  mechanism is polling (`daemon-log.ts:146`, 1s `setInterval`, `.unref()`).
- The bus (`ConductorEventEmitter.emit`) awaits handlers and swallows their errors —
  subscriber isolation is already guaranteed (Wave B).
- Wave C ruling: additional UI subscribers ship as **discoverable `ui_renderer`
  plugins** (plugin.yml, JSON line per event on stdout, zero `src/index.ts` edits).
- `rework_cycles` (named in issue #347) **does not exist** in `task-status.json`; the
  retry/thrash accounting that does exist is `task-evidence.json`'s per-task
  `noEvidenceAttempts` (`task-evidence.ts:19`).
- `EventPersister.ALL_EVENT_TYPES` is a hand-maintained list that has already drifted
  from the union — new event kinds must be added there explicitly or they are not
  persisted to `events.jsonl`.

## Options Considered

### Option A: Engine-side BuildProgressWatcher (poll + diff + emit) — CHOSEN
While the build step's promise is pending, the conductor runs a watcher: an
`.unref()`'d `setInterval` that reads `task-status.json` + the worktree git HEAD,
diffs against the last snapshot, and emits events **on change** (plus a low-frequency
heartbeat). Stopped in a `finally` when the step settles.
- **Pros:** deterministic, in-process (direct bus access); reuses the exact ground
  truth the stall breaker already trusts; polling matches the codebase's only
  existing follow pattern; zero protocol changes to the runner/agent side.
- **Cons:** new timer lifecycle in the run loop (leak risk — mitigated by
  `finally` + `.unref()`); poll granularity (~30s) bounds signal freshness.

### Option B: Runner-push (task-cli emits progress)
`task-cli start/done` already flips task rows from inside the build worktree; have it
push events to the daemon.
- **Pros:** event-driven, zero polling latency.
- **Cons:** task-cli runs in a **separate process** with no bus access — requires an
  IPC channel or an append file the conductor must still poll/read; all of A's
  machinery plus a protocol; couples the agent-side CLI to daemon internals.

### Option C: Boundary-only enrichment (no intra-step signal)
Render `build_stall`, add resolved/total counts to step-boundary events, stop there.
- **Pros:** trivial.
- **Cons:** fails the core requirement — a 56-minute silent build stays silent.
  (Its cheap wins are folded into A regardless.)

## Decision

**Option A**, with these contracts:

1. **Two new `ConductorEvent` kinds** in `types/events.ts`:
   - `build_progress { step, resolved, total, currentTaskId?, currentTaskName?,
     commitCount?, noEvidenceAttempts?, featureSlug? }` — emitted when the snapshot
     changes (task resolved, current task advanced, new worktree commit), and as a
     periodic heartbeat at a much slower cadence (default 5 min) so `daemon status`'s
     log-tail stays fresh during long single tasks.
   - `build_no_progress { step, quietMinutes, resolved, total, currentTaskId?,
     lastCommitAt?, featureSlug? }` — emitted **once per quiet episode** when neither
     task counts nor worktree HEAD moved for the quiet threshold (default 15 min);
     re-armed when progress resumes. This is the daemon-mode-usable stall signal the
     interactive-only `build_stall` handoff never provided.
   Payloads carry `featureSlug` so multi-feature daemon logs are attributable
   (dovetails with issue #254).
2. **Thrash signal adaptation** (explicit deviation from issue #347's letter):
   `rework_cycles` does not exist; the watcher surfaces `task-evidence.json`'s
   `noEvidenceAttempts` when present instead. No new counter is invented.
3. **Watcher lifecycle:** created by the conductor **only for the build step**, started
   before the `stepRunner.run` await, stopped in a `finally`; interval `.unref()`'d so
   it can never hold the process open; all fs reads inside the tick are try/caught
   (missing/unparseable file = "no change", mirroring `countResolvedTasks`).
4. **Existing breaker unchanged:** the post-hoc `build_stall` emission and auto-park
   semantics are not modified. This feature only makes the signal *visible* and adds
   the intra-step layer beneath it.
5. **Render paths:** add cases for `build_progress`, `build_no_progress`, and the
   hitherto-dropped `build_stall` to `renderDaemonEvent` (daemon.log) and
   `createRenderer` (TTY); subscribe + map all three in `OtelVisualizer`; append all
   new kinds to `EventPersister.ALL_EVENT_TYPES`.
6. **UI plugin per Wave C:** a discoverable `ui_renderer` plugin (plugin.yml under
   `.ai-conductor/plugins/`), one JSON line per event to stdout — no `src/index.ts`
   edits, no SSE/HTTP server.
7. **Config:** optional `build_progress` block in `HarnessConfig` (pattern:
   `OtelConfig`): `{ poll_seconds?: number (30), quiet_minutes?: number (15),
   heartbeat_minutes?: number (5), enabled?: boolean (true) }`. Absent block =
   defaults ON — observability should not require opt-in config; `enabled: false` is
   the escape hatch.

## Consequences

### Positive
- Daemon logs, OTel, `events.jsonl`, and `daemon status` show "build 20/21, advancing"
  instead of a silent hour; stall warnings reach autonomous runs.
- #280's halt-vs-continue fix gains a trustworthy forward-progress feed.
- `build_stall` finally renders everywhere; #254 gets per-event feature attribution.

### Negative
- A new timer in the run loop — lifecycle bugs would leak intervals (mitigated:
  `finally` + `.unref()` + single-owner start/stop).
- Poll cadence bounds freshness to ~30s; sub-poll churn is invisible (acceptable —
  the consumer is a human/telemetry, not a control loop).
- Three more hand-maintained subscriber lists to keep in sync (accepted; a
  union-exhaustiveness test story will pin them).

### Follow-up Actions
- [ ] Stories + plan for: event kinds, watcher module, conductor wiring, four render
      paths, ui_renderer plugin, config block, exhaustiveness guard test.
- [ ] Issue #280 design can consume `build_no_progress` (out of scope here).
