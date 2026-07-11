**Status:** Accepted

# Stories: Emit intra-step build progress + stall as events (issue #347)

Technical track — acceptance criteria derive from issue #347 intent + APPROVED
`adr-2026-07-10-intra-step-build-progress-events`. Traceability tags reference the
ADR's Decision points (D-1 … D-7).

---

## Story: build_progress emitted when the build advances

**Requirement:** D-1, D-3

As a daemon operator, I want a `build_progress` event whenever the build's task state
or worktree commits advance, so a long build is observable without opening the worktree.

### Acceptance Criteria

#### Happy Path
- Given a build step is running with 5 of 21 tasks resolved, when `task-status.json`
  changes to 6 resolved, then the bus emits `build_progress` with `resolved: 6`,
  `total: 21`, and the current task id/name from the status file within one poll interval.
- Given a build step is running, when a new commit lands on the worktree HEAD with no
  task-count change, then `build_progress` is emitted with the updated `commitCount`.
- Given `task-evidence.json` carries `noEvidenceAttempts: 2`, when `build_progress` is
  emitted, then the payload includes `noEvidenceAttempts: 2`.
- Given a feature slug is known to the conductor, when `build_progress` is emitted,
  then the payload carries `featureSlug` (issue #254 attributability).

#### Negative Paths
- Given a poll tick where neither `task-status.json`, worktree HEAD, nor
  `noEvidenceAttempts` changed, when the tick completes (heartbeat not yet due), then
  NO `build_progress` event is emitted (change-driven, not cadence-driven).
- Given `task-status.json` is missing or unparseable mid-build, when a poll tick runs,
  then no event is emitted, no error is thrown, and the watcher keeps polling (treated
  as "no change", mirroring `countResolvedTasks`).
- Given `task-status.json` is in the legacy map shape (`Record<id, {status}>`) rather
  than `{tasks: []}`, when it advances, then `build_progress` still reports the correct
  resolved count (tolerant parse reused, not reimplemented).
- Given the `git` HEAD probe fails (e.g. corrupted worktree), when a poll tick runs,
  then the tick degrades to task-file-only diffing and never throws.
- Given a non-build step (e.g. `plan`, `finish`) is running, when it takes a long
  time, then no watcher runs and no `build_progress` events are emitted.

### Done When
- [ ] `types/events.ts` union includes `build_progress` with the payload fields from
      ADR D-1; TypeScript compiles with exhaustive discriminant handling intact.
- [ ] Unit tests cover: change-driven emission (task delta, commit delta), payload
      shape, both task-status schemas, missing/corrupt file, git-probe failure.
- [ ] A daemon-mode integration test observes ≥1 `build_progress` on the bus when the
      fake build flips a task row.

---

## Story: heartbeat keeps long single tasks observable

**Requirement:** D-1

As a daemon operator, I want a low-frequency heartbeat re-emit during a long
single task, so "no new event" never means "unknown state" for more than the
heartbeat period.

### Acceptance Criteria

#### Happy Path
- Given a build step where no snapshot change occurs for the heartbeat period
  (default 5 min), when the heartbeat elapses, then `build_progress` is re-emitted
  with the current (unchanged) snapshot.

#### Negative Paths
- Given change-driven emissions are occurring more frequently than the heartbeat
  period, when polls tick, then no additional heartbeat duplicates are interleaved
  (heartbeat timer resets on every emission).
- Given the build step settles, when the heartbeat period later elapses, then no
  further events are emitted (watcher stopped).

### Done When
- [ ] Unit test with fake timers: silent build emits exactly one heartbeat per
      heartbeat period, none after stop, none between change-driven emissions.

---

## Story: build_no_progress fires once per quiet episode

**Requirement:** D-1, D-2

As a daemon operator, I want a `build_no_progress` event when nothing has moved for
the quiet threshold, so autonomous runs surface probable stalls without an
interactive handoff.

### Acceptance Criteria

#### Happy Path
- Given a build step where task counts, current task, worktree HEAD, and
  `noEvidenceAttempts` are all unchanged for the quiet threshold (default 15 min),
  when the threshold elapses, then the bus emits `build_no_progress` with
  `quietMinutes`, the last snapshot (`resolved`, `total`, `currentTaskId`), and
  `featureSlug`.
- Given a `build_no_progress` was emitted and progress then resumes (any snapshot
  change), when a later quiet period again exceeds the threshold, then a second
  `build_no_progress` is emitted (episode re-armed).

#### Negative Paths
- Given a quiet episode already signalled, when subsequent poll ticks stay quiet,
  then NO further `build_no_progress` events are emitted for that episode (at most
  one per episode — not a page per tick).
- Given progress resumes 1 poll tick before the threshold, when the tick observes the
  change, then no `build_no_progress` is emitted and the quiet clock resets.
- Given the existing post-hoc stall breaker conditions are met after the step settles,
  when the breaker runs, then its `build_stall` emission and auto-park behavior are
  byte-for-byte unchanged by this feature (watcher adds a layer, replaces nothing).

### Done When
- [ ] `types/events.ts` union includes `build_no_progress` per ADR D-1.
- [ ] Fake-timer unit tests: threshold fire, once-per-episode suppression, re-arm on
      resume, reset-on-late-progress.
- [ ] Existing stall-breaker tests pass unmodified.

---

## Story: watcher lifecycle is leak-proof and build-step-scoped

**Requirement:** D-3

As a harness maintainer, I want the watcher's timer owned by the build-step call site
with guaranteed teardown, so no interval ever outlives its step or holds the process open.

### Acceptance Criteria

#### Happy Path
- Given the conductor enters the build step, when `stepRunner.run` is awaited, then
  exactly one watcher instance is running, rooted at the conductor's `projectRoot`.
- Given the step settles successfully, when the await returns, then the watcher is
  stopped and its interval cleared before the completion gate runs.

#### Negative Paths
- Given `stepRunner.run` throws (or the self-build dispatch path errors), when the
  exception propagates, then the watcher is still stopped (teardown in `finally`) and
  no interval remains registered.
- Given the watcher is running, when the Node process would otherwise exit (daemon
  shutdown mid-build), then the `.unref()`'d interval does not hold the process open.
- Given two conductor instances run concurrently in separate worktrees (parallel
  daemon builds), when both build steps run, then each watcher reads only its own
  `projectRoot` and events carry the correct per-feature slug (no cross-talk).
- Given a poll tick is still awaiting its fs reads when `stop()` is called, when the
  tick resolves, then it emits nothing after stop (stopped flag checked post-read).

### Done When
- [ ] Watcher module exposes `start()`/`stop()`; `stop()` is idempotent.
- [ ] Conductor wires start-before-await and stop-in-`finally` for the build step only.
- [ ] Unit tests assert: no emission after stop, idempotent stop, unref'd timer
      (inspectable via fake timers), throw-path teardown.

---

## Story: daemon.log renders progress, no-progress, and stall lines

**Requirement:** D-5

As a daemon operator reading `daemon.log` (and `conduct daemon status`), I want
heartbeat and warning lines for the new events plus the previously-dropped
`build_stall`, so the log tail always reflects intra-build state.

### Acceptance Criteria

#### Happy Path
- Given the daemon renderer receives `build_progress {resolved: 20, total: 21}`, when
  it renders, then daemon.log gains a single line containing the step, `20/21`, the
  current task, and the feature slug.
- Given `build_no_progress {quietMinutes: 15}` arrives, then daemon.log gains a
  clearly-marked warning line (visually distinct from heartbeat lines) with the quiet
  duration and last snapshot.
- Given `build_stall` arrives (post-hoc breaker), then daemon.log gains a stall line
  with `reason` and before/after counts — today this event is silently dropped.
- Given a `build_progress` line was the last write, when `conduct daemon status` runs,
  then its `lastActivity` shows that progress line (freshness for free via log tail).

#### Negative Paths
- Given any other event kind not handled by `renderDaemonEvent`, when it arrives, then
  behavior is unchanged (default: no line — no accidental log spam from this change).
- Given the renderer throws on a malformed payload, when the bus dispatches, then the
  engine run is unaffected (bus swallows subscriber errors — assert no crash).

### Done When
- [ ] `renderDaemonEvent` handles all three kinds; unit tests snapshot each line.
- [ ] An integration test tails a daemon.log written through `DaemonLogSink` and finds
      the `N/M` heartbeat line after a simulated task flip.

---

## Story: TTY renderer renders the three kinds

**Requirement:** D-5

As an interactive `conduct` user, I want the same three events rendered in the
terminal, so TTY runs get the identical signal daemon logs do.

### Acceptance Criteria

#### Happy Path
- Given `createRenderer` receives `build_progress`, `build_no_progress`, or
  `build_stall`, when it renders, then each produces a distinct human-readable line
  (progress line, warning line, stall line).

#### Negative Paths
- Given an event kind the renderer does not know, when it arrives, then rendering
  behavior for existing kinds is unchanged and nothing throws (no `default` crash).

### Done When
- [ ] `createRenderer` switch handles all three kinds with unit-tested output.

---

## Story: OTel visualizer exports the three kinds

**Requirement:** D-5

As an operator with OTel export enabled, I want progress/no-progress/stall on the
existing trace spans, so external telemetry shows intra-build state.

### Acceptance Criteria

#### Happy Path
- Given the OTel visualizer is started, when `build_progress` /
  `build_no_progress` / `build_stall` are emitted, then each is recorded as a span
  event (or attribute update) on the active build-step span, including
  resolved/total and reason fields.

#### Negative Paths
- Given the OTel exporter is not configured (default off), when the events are
  emitted, then nothing is exported and nothing throws.
- Given the active step span is absent (event races span close), when the handler
  runs, then it degrades to a no-op without throwing (handlers must not block
  `emit()`).

### Done When
- [ ] `eventTypes` subscription list and `handleEvent` switch cover the three kinds.
- [ ] Unit tests assert span-event mapping and the no-active-span no-op.

---

## Story: EventPersister persists the new kinds, guarded against drift

**Requirement:** D-5

As a harness maintainer, I want the new kinds in `events.jsonl` and a guard that the
hand-maintained subscriber lists cannot silently drift for these events again.

### Acceptance Criteria

#### Happy Path
- Given the persister is active, when `build_progress` / `build_no_progress` are
  emitted, then each appears as a line in `events.jsonl` with a timestamp.
- Given the union gains the two new kinds, when the exhaustiveness guard test runs,
  then it fails if `ALL_EVENT_TYPES` is missing `build_progress`,
  `build_no_progress`, or `build_stall`.

#### Negative Paths
- Given `events.jsonl` is unwritable, when a new-kind event is emitted, then the
  engine run continues (persister errors are swallowed like any subscriber's).
- Given a future contributor adds a new union member without updating
  `ALL_EVENT_TYPES` for THESE kinds' family (progress/stall), when the guard test
  runs, then it fails with a message naming the missing kind. (Full back-fill of all
  pre-existing drifted kinds is explicitly out of scope — separate issue.)

### Done When
- [ ] `ALL_EVENT_TYPES` includes the three kinds; persisted-line unit test passes.
- [ ] A compile-time or test-time exhaustiveness check pins the progress/stall family
      across persister + both renderers + OTel subscription list.

---

## Story: existing json-stdout ui_renderer receives the new kinds

**Requirement:** D-6

> Amended by conflict-check 2026-07-10: the Wave C JSON-stdout plugin ALREADY ships
> (`plugins/json-stdout-subscriber`, stories `wave-c-json-stdout-subscriber.md`).
> This story extends the UI fan-out so that plugin — unchanged — receives the new
> kinds; it does NOT create a second plugin.

As an operator building external UIs, I want the shipped `json-stdout` `ui_renderer`
to receive `build_progress`, `build_no_progress`, and `build_stall`, so a live view
consumes the full stream — with zero engine-wiring edits and no new plugin.

### Acceptance Criteria

#### Happy Path
- Given `ui_renderer: json-stdout` is selected, when `build_progress`,
  `build_no_progress`, or `build_stall` is emitted, then exactly one JSON line
  (`{...event, ts}`) per event is written to stdout — with NO change to the plugin's
  own source (its `handle()` is already generic; only the UI subscription fan-out
  list gains the new kinds).
- Given the default terminal `ui_renderer` is selected, when the same events are
  emitted, then the fan-out delivers them to it equally (one subscription list serves
  every registered `ui_renderer`).

#### Negative Paths
- Given a `ui_renderer` whose `handle()` throws (e.g. stdout closed/EPIPE), when the
  new events are emitted, then the engine run is unaffected and other subscribers
  still render (dispatch isolation preserved).
- Given the Wave C constraint "zero `src/index.ts` edits for subscriber changes",
  when this feature lands, then `src/index.ts` wiring is untouched (subscription list
  lives in the UI subscriber/dispatch layer, not entry-point wiring).

### Done When
- [ ] UI subscription fan-out (`ui/subscriber.ts` list) includes the three kinds.
- [ ] Test: with a fake stdout, the shipped json-stdout plugin emits one JSON line per
      new-kind event; a throwing renderer does not break dispatch to its siblings.
- [ ] `plugins/json-stdout-subscriber/index.ts` diff is empty for this feature.

---

## Story: build_progress config block with safe defaults

**Requirement:** D-7

As an operator, I want polling/threshold knobs in `HarnessConfig` with
observability-on defaults, so tuning is possible but never required.

### Acceptance Criteria

#### Happy Path
- Given no `build_progress` block in config, when a build runs, then the watcher runs
  with defaults (poll 30s, quiet 15m, heartbeat 5m).
- Given `build_progress: { quiet_minutes: 45 }`, when a build runs, then only the
  quiet threshold changes; other knobs keep defaults.
- Given `build_progress: { enabled: false }`, when a build runs, then no watcher
  starts and no progress/no-progress events are emitted (post-hoc `build_stall`
  breaker still functions).

#### Negative Paths
- Given a non-numeric or ≤0 value for any knob, when config is validated, then
  `validateConfig()` rejects it with a message naming the field (fail-closed on
  nonsense, never a silent fallback to a surprise value).
- Given `poll_seconds` larger than `quiet_minutes` converted to seconds, when config
  is validated, then validation rejects the combination (a quiet threshold below one
  poll tick can never fire correctly).

### Done When
- [ ] `types/config.ts` gains the optional block (pattern: `OtelConfig`), wired
      through `validateConfig()` with the two rejection rules unit-tested.
- [ ] Defaults documented in `src/conductor/README.md` and root `README.md`
      (docs-track-features rule).
