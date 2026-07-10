# Implementation Plan: Emit intra-step build progress + stall as events (issue #347)

**Date:** 2026-07-10
**Design:** .docs/decisions/adr-2026-07-10-intra-step-build-progress-events.md (APPROVED)
**Stories:** .docs/stories/emit-intra-step-build-progress-and-stall-as-events.md (Accepted)
**Conflict check:** Clean as of 2026-07-10 (.docs/conflicts/2026-07-10-emit-intra-step-build-progress-and-stall-as-events.md)

## Summary

Adds two ConductorEvent kinds (`build_progress`, `build_no_progress`), a
BuildProgressWatcher that polls the build worktree's task/commit state while the
build step is awaited, and render/export coverage for them (plus the
hitherto-dropped `build_stall`) across daemon.log, TTY, OTel, events.jsonl, and the
shipped json-stdout ui_renderer. 18 tasks.

## Technical Approach

- **Ground truth, read-only:** the watcher reuses the tolerant `task-status.json`
  parse (`countFromParsed` semantics in `src/conductor/src/engine/task-progress.ts`)
  plus a `git rev-parse HEAD`-based commit probe and an optional
  `task-evidence.json` read. Missing/corrupt inputs = "no change"; never throw from
  a tick.
- **New module, single owner:** `src/conductor/src/engine/build-progress-watcher.ts`
  exports a class with `start()`/`stop()` (idempotent), an `.unref()`'d
  `setInterval`, a last-seen snapshot `{resolved, total, currentTaskId, head,
  noEvidenceAttempts}`, a heartbeat clock, and a quiet-episode flag with re-arm.
  Emission is change-driven; `build_no_progress` fires at most once per quiet
  episode. A `stopped` flag is checked after each async tick so a late tick never
  emits post-stop.
- **Conductor wiring:** in `runStep`'s build branch, construct/start the watcher
  just before the `stepRunner.run` await (also covering the self-build dispatch
  path), `stop()` in a `finally`. Only `step.name === 'build'` gets a watcher. The
  existing post-hoc stall breaker (`build_stall` at ~`conductor.ts:1762`) is not
  modified.
- **Config:** optional `build_progress` block in `HarnessConfig`
  (`src/conductor/src/types/config.ts`, pattern: `OtelConfig`), validated in
  `validateConfig` (`src/conductor/src/engine/config.ts`): positive numbers only;
  reject `poll_seconds > quiet_minutes*60`; `enabled: false` disables the watcher
  only (breaker untouched). Defaults: poll 30s, quiet 15m, heartbeat 5m, enabled.
- **Render/export coverage:** add cases for the three kinds to `renderDaemonEvent`
  (`src/conductor/src/daemon-cli.ts`), `createRenderer`
  (`src/conductor/src/ui/create-renderer.ts`), `OtelVisualizer`
  (`src/conductor/src/engine/otel/otel-visualizer.ts`), and
  `EventPersister.ALL_EVENT_TYPES` (`src/conductor/src/engine/event-persister.ts`);
  extend the UI fan-out list in `src/conductor/src/ui/subscriber.ts` so every
  `ui_renderer` (terminal + shipped json-stdout plugin, unchanged) receives them.
  A guard test pins the progress/stall family across all five lists.
- **Sequencing:** contracts first (events, config), then the watcher core
  (snapshot → diff → heartbeat → episodes → lifecycle), then conductor wiring, then
  the five subscriber surfaces (parallelizable), then the guard test + docs.
- **Merge-order note (conflict report Note A):** PR #470 reworks
  completion-evidence code adjacent to the stall breaker; standard spec-branch
  rebase applies — this plan touches the breaker's *rendering* only, never its
  logic.

## Prerequisites

None — no migrations, no new dependencies. `npm install` inside `src/conductor`
per worktree (existing convention). Run tests from `src/conductor` (vitest config
lives there).

## Tasks

### Task 1: Add build_progress and build_no_progress to the event union
**Story:** S1 "build_progress emitted when the build advances" (Done When 1); S3 (Done When 1)
**Type:** infrastructure

**Steps:**
1. Write failing test: type-level test (or compile-step assertion) that
   `ConductorEvent` accepts `{type:'build_progress', step, resolved, total,
   currentTaskId?, currentTaskName?, commitCount?, noEvidenceAttempts?,
   featureSlug?}` and `{type:'build_no_progress', step, quietMinutes, resolved,
   total, currentTaskId?, lastCommitAt?, featureSlug?}`.
2. Verify test fails (RED).
3. Implement: add both members to the discriminated union with doc comments.
4. Verify test passes (GREEN); `npx tsc --noEmit` clean.
5. Commit: "feat(events): add build_progress and build_no_progress event kinds"

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/test/build-progress-events.test.ts

**Dependencies:** none

### Task 2: build_progress config block + validation
**Story:** S10 "config block with safe defaults" (both happy criteria)
**Type:** infrastructure

**Steps:**
1. Write failing test: config with no `build_progress` block resolves defaults
   {poll_seconds:30, quiet_minutes:15, heartbeat_minutes:5, enabled:true}; partial
   block `{quiet_minutes:45}` keeps other defaults.
2. Verify RED.
3. Implement: `BuildProgressConfig` interface in types/config.ts (pattern:
   OtelConfig) + resolver with defaults.
4. GREEN.
5. Commit: "feat(config): optional build_progress block with defaults"

**Files:**
- src/conductor/src/types/config.ts
- src/conductor/src/engine/config.ts
- src/conductor/test/build-progress-config.test.ts

**Dependencies:** none

### Task 3: config validation rejects nonsense values
**Story:** S10 negative paths (non-numeric/≤0 knob; poll > quiet window)
**Type:** negative-path

**Steps:**
1. Write failing tests: `validateConfig` rejects `poll_seconds: 0`,
   `quiet_minutes: -5`, `heartbeat_minutes: "fast"`, and
   `{poll_seconds: 1200, quiet_minutes: 15}` — each error names the field.
2. Verify RED.
3. Implement validation rules in `validateConfig`.
4. GREEN.
5. Commit: "feat(config): fail-closed validation for build_progress knobs"

**Files:**
- src/conductor/src/engine/config.ts
- src/conductor/test/build-progress-config.test.ts

**Dependencies:** Task 2

### Task 4: watcher snapshot reader (tolerant inputs)
**Story:** S1 negative paths (missing/unparseable status file; legacy map schema; git probe failure)
**Type:** infrastructure

**Steps:**
1. Write failing tests for a `readSnapshot(projectRoot)` helper: returns
   {resolved, total, currentTaskId, currentTaskName} from `{tasks:[]}` shape AND
   legacy map shape; missing/corrupt file → null-ish "no data" snapshot without
   throwing; git HEAD probe failure → snapshot without `head`; reads
   `noEvidenceAttempts` from task-evidence.json when present.
2. Verify RED.
3. Implement in new module `build-progress-watcher.ts`, reusing/exporting the
   tolerant parse from task-progress.ts (no new parser).
4. GREEN.
5. Commit: "feat(watcher): tolerant snapshot reader over task-status/evidence/HEAD"

**Files:**
- src/conductor/src/engine/build-progress-watcher.ts
- src/conductor/src/engine/task-progress.ts
- src/conductor/test/build-progress-watcher.test.ts

**Dependencies:** Task 1

### Task 5: change-driven build_progress emission
**Story:** S1 happy paths (task delta, commit delta, noEvidenceAttempts + featureSlug in payload); S1 negative "no change → no event"
**Type:** happy-path

**Steps:**
1. Write failing tests (fake timers, fake emitter): task count 5→6 emits
   build_progress{resolved:6,total:21,...} within one tick; new HEAD with no task
   delta emits with commitCount; unchanged tick emits nothing; payload carries
   featureSlug + noEvidenceAttempts.
2. Verify RED.
3. Implement diff-and-emit in the watcher tick.
4. GREEN.
5. Commit: "feat(watcher): change-driven build_progress emission"

**Files:**
- src/conductor/src/engine/build-progress-watcher.ts
- src/conductor/test/build-progress-watcher.test.ts

**Dependencies:** Task 4

### Task 6: heartbeat re-emit
**Story:** S2 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests: silent build re-emits current snapshot once per heartbeat
   period; heartbeat clock resets on every change-driven emission (no interleaved
   duplicates); nothing after stop.
2. Verify RED.
3. Implement heartbeat clock.
4. GREEN.
5. Commit: "feat(watcher): heartbeat build_progress during long single tasks"

**Files:**
- src/conductor/src/engine/build-progress-watcher.ts
- src/conductor/test/build-progress-watcher.test.ts

**Dependencies:** Task 5

### Task 7: quiet-episode build_no_progress
**Story:** S3 (happy: threshold fire + re-arm; negatives: once per episode, reset on late progress)
**Type:** happy-path

**Steps:**
1. Write failing tests: all-quiet past threshold emits build_no_progress
   {quietMinutes, resolved, total, currentTaskId, featureSlug} exactly once;
   continued quiet emits no more; any change re-arms → a later quiet episode fires
   again; change 1 tick before threshold resets the clock.
2. Verify RED.
3. Implement quiet-episode state (armed/fired) in the watcher.
4. GREEN.
5. Commit: "feat(watcher): once-per-episode build_no_progress with re-arm"

**Files:**
- src/conductor/src/engine/build-progress-watcher.ts
- src/conductor/test/build-progress-watcher.test.ts

**Dependencies:** Task 5

### Task 8: watcher lifecycle hardening
**Story:** S4 (idempotent stop, unref'd timer, no emission after stop, late-tick guard)
**Type:** negative-path

**Steps:**
1. Write failing tests: stop() twice is safe; timer handle is unref'd; a tick
   resolving after stop() emits nothing; start() twice does not double-tick.
2. Verify RED.
3. Implement stopped-flag checks + idempotency.
4. GREEN.
5. Commit: "feat(watcher): leak-proof start/stop lifecycle"

**Files:**
- src/conductor/src/engine/build-progress-watcher.ts
- src/conductor/test/build-progress-watcher.test.ts

**Dependencies:** Task 5

### Task 9: conductor wires watcher around the build-step await
**Story:** S4 happy paths (one watcher during build, rooted at projectRoot; stopped before completion gate); S1 negative (no watcher on non-build steps)
**Type:** happy-path

**Steps:**
1. Write failing test (conductor-level, fake step runner): build step run →
   watcher started with this.projectRoot before the await, stopped when the await
   returns; plan/finish steps → no watcher constructed.
2. Verify RED.
3. Implement: construct from resolved build_progress config (skip when
   enabled:false), start before the run/self-build-dispatch await, stop in finally.
4. GREEN.
5. Commit: "feat(conductor): run BuildProgressWatcher during the build step"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/conductor-build-progress.test.ts

**Dependencies:** Tasks 2, 5, 8

### Task 10: conductor teardown on throw + disabled config
**Story:** S4 negative (stepRunner.run throws → watcher stopped); S10 happy (enabled:false → no watcher, breaker intact)
**Type:** negative-path

**Steps:**
1. Write failing tests: step runner rejects → watcher stopped (finally) and error
   propagation unchanged; `build_progress.enabled:false` → no watcher instance, and
   existing stall-breaker path still emits build_stall under its conditions.
2. Verify RED.
3. Implement/adjust the finally + enabled gate.
4. GREEN; run existing conductor stall-breaker tests unmodified — must stay green.
5. Commit: "feat(conductor): watcher teardown on failure; enabled:false escape hatch"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/conductor-build-progress.test.ts

**Dependencies:** Task 9

### Task 11: daemon.log renders the three kinds
**Story:** S5 happy (heartbeat line, warning line, stall line); S5 negative (unknown kinds unchanged; throwing renderer doesn't crash run)
**Type:** happy-path

**Steps:**
1. Write failing tests: renderDaemonEvent(build_progress{20/21}) → one line with
   step, 20/21, current task, feature slug; build_no_progress → visually distinct
   warning line with quiet minutes; build_stall → stall line with reason +
   before/after; unhandled kinds still produce no line; handler throw is swallowed
   by the bus (no crash).
2. Verify RED.
3. Implement the three cases.
4. GREEN.
5. Commit: "feat(daemon): render build progress/no-progress/stall in daemon.log"

**Files:**
- src/conductor/src/daemon-cli.ts
- src/conductor/test/daemon-render-progress.test.ts

**Dependencies:** Task 1

### Task 12: daemon status freshness integration
**Story:** S5 happy ("lastActivity shows the progress line via log tail")
**Type:** happy-path

**Steps:**
1. Write failing integration test: write a build_progress line through the
   DaemonLogSink path; `computeStatusRow`'s lastActivity equals that line.
2. Verify RED (before renderer wiring lands it's red; with Task 11 merged this
   validates the end-to-end seam).
3. Implement any glue needed (expected: none beyond Task 11 — this is a seam test).
4. GREEN.
5. Commit: "test(daemon): status lastActivity surfaces build progress heartbeat"

**Files:**
- src/conductor/test/daemon-render-progress.test.ts
- src/conductor/src/engine/daemon-observe-cli.ts

**Dependencies:** Task 11

### Task 13: TTY renderer renders the three kinds
**Story:** S6 (happy + negative)
**Type:** happy-path

**Steps:**
1. Write failing tests: createRenderer output lines for build_progress /
   build_no_progress / build_stall are distinct and human-readable; unknown kinds
   still no-op without throwing.
2. Verify RED.
3. Implement the three switch cases.
4. GREEN.
5. Commit: "feat(ui): TTY render cases for progress/no-progress/stall"

**Files:**
- src/conductor/src/ui/create-renderer.ts
- src/conductor/test/create-renderer-progress.test.ts

**Dependencies:** Task 1

### Task 14: UI fan-out list feeds every ui_renderer (json-stdout passthrough)
**Story:** S9 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests: TerminalSubscriber's subscription list includes the three
   kinds; with the shipped json-stdout plugin as renderer and a captured stdout,
   each new-kind event produces exactly one `{...event, ts}` JSON line; a throwing
   renderer does not break dispatch to siblings; `git diff --stat` for
   plugins/json-stdout-subscriber/index.ts is empty.
2. Verify RED.
3. Implement: add the three kinds to the ui/subscriber.ts list. No index.ts edits.
4. GREEN.
5. Commit: "feat(ui): fan out progress/stall events to all ui_renderers"

**Files:**
- src/conductor/src/ui/subscriber.ts
- src/conductor/test/json-stdout-progress.test.ts

**Dependencies:** Task 1

### Task 15: OTel maps the three kinds
**Story:** S7 happy path
**Type:** happy-path

**Steps:**
1. Write failing tests: with visualizer started, emitting the three kinds records
   span events on the active build-step span with resolved/total/reason attributes.
2. Verify RED.
3. Implement: extend eventTypes subscription array + handleEvent switch +
   span-manager mapping.
4. GREEN.
5. Commit: "feat(otel): export build progress/no-progress/stall as span events"

**Files:**
- src/conductor/src/engine/otel/otel-visualizer.ts
- src/conductor/src/engine/otel/span-manager.ts
- src/conductor/test/otel-progress.test.ts

**Dependencies:** Task 1

### Task 16: OTel negative paths
**Story:** S7 negatives (exporter off → nothing; no active span → no-op, non-blocking)
**Type:** negative-path

**Steps:**
1. Write failing tests: OTel disabled → no subscription/export and no throw;
   event arriving with no active step span → handler no-ops synchronously.
2. Verify RED.
3. Implement guards.
4. GREEN.
5. Commit: "feat(otel): graceful no-op for progress events without active span"

**Files:**
- src/conductor/src/engine/otel/otel-visualizer.ts
- src/conductor/test/otel-progress.test.ts

**Dependencies:** Task 15

### Task 17: EventPersister + exhaustiveness guard
**Story:** S8 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests: build_progress/build_no_progress emitted → one events.jsonl
   line each with ts; unwritable file → run continues; guard test fails if any of
   the three kinds is missing from ALL_EVENT_TYPES, the ui/subscriber.ts list, the
   daemon renderer, the TTY renderer, or the OTel subscription list (message names
   the missing kind + list).
2. Verify RED.
3. Implement: add kinds to ALL_EVENT_TYPES; write the guard as a test-time pin of
   the progress/stall family across the five lists (full back-fill of other
   drifted kinds out of scope).
4. GREEN.
5. Commit: "feat(persister): persist progress events; guard subscriber-list drift"

**Files:**
- src/conductor/src/engine/event-persister.ts
- src/conductor/test/event-persister-progress.test.ts
- src/conductor/test/progress-event-coverage.test.ts

**Dependencies:** Tasks 11, 13, 14, 15

### Task 18: docs + changelog
**Story:** S10 Done When (docs); repo Docs-track-features rule
**Type:** infrastructure

**Steps:**
1. Update src/conductor/README.md (build_progress config block, defaults, event
   kinds, daemon.log lines) and root README.md (daemon observability section).
2. Add CHANGELOG.md `[Unreleased]` → Added entry.
3. Verify test/test_harness_integrity.sh passes.
4. Commit: "docs: build progress/stall events, config knobs, changelog"

**Files:**
- README.md
- src/conductor/README.md
- CHANGELOG.md

**Dependencies:** Tasks 9, 11, 13, 14, 15, 17

## Task Dependency Graph

```
1 ──┬─▶ 4 ─▶ 5 ─┬─▶ 6
    │           ├─▶ 7
    │           └─▶ 8 ─┐
2 ─▶ 3             ▼
2 ──────────▶ 9 ─▶ 10
1 ──┬─▶ 11 ─▶ 12
    ├─▶ 13
    ├─▶ 14
    └─▶ 15 ─▶ 16
11,13,14,15 ─▶ 17
9,11,13,14,15,17 ─▶ 18
```

## Integration Points

- After Task 10: a fake daemon build emits progress/no-progress on the live bus
  end-to-end (engine side complete).
- After Task 12: daemon.log + `daemon status` show "build N/M" for a simulated run.
- After Task 17: every subscriber surface renders/persists the family; guard pins it.

## Verification

- [ ] All happy path criteria covered: S1→T5/T9, S2→T6, S3→T7, S4→T9, S5→T11/T12,
      S6→T13, S7→T15, S8→T17, S9→T14, S10→T2/T10
- [ ] All negative path criteria covered: S1→T4/T5/T9, S2→T6, S3→T7/T10, S4→T8/T10,
      S5→T11, S6→T13, S7→T16, S8→T17, S9→T14, S10→T3
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
