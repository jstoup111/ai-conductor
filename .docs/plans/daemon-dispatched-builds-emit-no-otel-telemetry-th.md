# Implementation Plan: Daemon-dispatched builds emit OTel telemetry via the shared visualizer seam

**Date:** 2026-08-26
**Stories:** .docs/stories/daemon-dispatched-builds-emit-no-otel-telemetry-th.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Wire the existing OtelVisualizer into the daemon's per-feature dispatch through one shared
wiring helper used by both entry points, with registry-derived subscriptions, read-only run-id
resolution, and a cross-path parity guard. 10 tasks.

## Technical Approach

- **Shared seam.** A new `wireOtelVisualizer(config, ctx, events)` helper in
  `src/conductor/src/engine/otel/wire.ts` composes `resolveOtelConfig` →
  `createOtelVisualizer` → `start()` and returns the started plugin or null.
  `createOtelVisualizer` moves from `index.ts` into this module (re-exported from `index.ts`
  so existing integration tests keep their import). `index.ts`'s inline block
  (`index.ts:1279-1296`) becomes a call to the helper; `daemon-cli.ts`'s `beginFeatureRun`
  (`daemon-cli.ts:926-942`) gains a second call — one visualizer per dispatch, attached to
  the feature-scoped bus.
- **C1 — run identity is read-only in the daemon path.** The step runner writes
  `.pipeline/conduct-session-id` only when absent, from its own `runId`
  (`src/conductor/src/engine/step-runners.ts:2608-2611`); adr-2026-07-27 D7 keeps it the sole
  writer. The dispatch session uuid currently minted inline in `runConductorInWorktree` moves
  up to `beginFeatureRun` and is threaded down as a parameter, so the helper's daemon context
  passes `ctx.runId` = (existing `conduct-session-id` content if the file exists, else that
  same session uuid). `buildResource` bypasses its file write whenever `ctx.runId` is
  supplied, so the visualizer never writes the file. Interactive path unchanged (no
  `ctx.runId`; existing behavior).
- **C2 — registry-derived subscriptions.** `SinkDeclaration`
  (`src/conductor/src/engine/event-sinks.ts`) gains an `otel: boolean` field with an
  `otelEventTypes()` accessor; `OtelVisualizer.start` subscribes to that derived set instead
  of its current 13-entry literal (`otel-visualizer.ts:298-311`). The exhaustive
  `Record<ConductorEvent['type'], SinkDeclaration>` is the mechanism that makes silent drift
  impossible: a new event type fails compilation until it declares its otel routing.
- **Flush on dispatch end.** `beginFeatureRun`'s returned `stop` becomes async and awaits the
  visualizer's `stop()` (idempotent; force-flushes both providers and unregisters its
  SIGINT/SIGTERM handlers) before detaching renderers and persistence; call sites await it.
  This covers clean, HALT, and error dispatch ends because the daemon runs `stop` on all of
  them.
- **C3 — parity guard.** A committed test drives both wiring paths with a fake exporter and
  asserts every `otelEventTypes()` signal observed by the interactive path is observed by the
  daemon path, failing with the missing type's name.
- **Sequencing.** Registry first (1-2), then run-id threading (3), then the shared helper and
  its two call sites (4-6), then flush (7), degradation negatives (8-9), parity last (10).
- Local pattern: the audit-trail sink is the wired-at-both-entry-points precedent
  (`AuditTrailWriter` constructed in `index.ts` and in `runConductorInWorktree`); the helper
  follows its shape — construct near the bus, subscribe, tear down with the owning scope.
  Search hints: `AuditTrailWriter`, `renderedEventTypes`, `startFeatureEventPersistence`.

## Prerequisites

None — all touched modules exist; no migrations, packages, or config keys.

## Tasks

### Task 1: Add the otel sink column to the event-sink registry
**Story:** Story 5 (EVENT_SINKS derivation happy path)
**Type:** infrastructure

**Steps:**
1. Write failing test: `otelEventTypes()` returns exactly the 13 event types the visualizer subscribes to today (step_started, step_completed, step_failed, step_retry, gate_verdict, kickback, feature_complete, build_progress, unattributed_progress, build_no_progress, build_stall, pipeline_closeout, plus verify the current literal in `otel-visualizer.ts:298-311` and mirror it exactly)
2. Verify test fails (RED)
3. Implement: add `otel: boolean` to `SinkDeclaration`, set it on every entry of `EVENT_SINKS` (true for exactly the mirrored set, false elsewhere), export `otelEventTypes()` via the existing `eventTypesFor` filter
4. Verify test passes (GREEN)
5. Commit with message: "Add otel sink column and otelEventTypes() to the event-sink registry"

**Done when:**
- The new test passes and asserts set equality (not subset) against the mirrored list
- Every `EVENT_SINKS` entry compiles with an explicit `otel` value (exhaustive Record — omission is a type error)
- `persistedEventTypes`/`auditedEventTypes`/`renderedEventTypes` outputs are unchanged (existing tests still pass)

**Files likely touched:**
- src/conductor/src/engine/event-sinks.ts — SinkDeclaration + EVENT_SINKS + otelEventTypes
- src/conductor/test/event-sinks.test.ts — derivation test

**Dependencies:** none

### Task 2: OtelVisualizer derives its subscriptions from the registry
**Story:** Story 5 (derivation negative path: new event type stays in sync)
**Type:** refactor

**Steps:**
1. Write failing test: `OtelVisualizer.start` subscribes to exactly `otelEventTypes()` (spy on `emitter.on`; assert the registered type set equals the derived set)
2. Verify test fails (RED)
3. Implement: replace the literal `eventTypes` array in `OtelVisualizer.start` (`src/conductor/src/engine/otel/otel-visualizer.ts:298-311`) with `otelEventTypes()`
4. Verify test passes (GREEN)
5. Commit with message: "Derive OtelVisualizer subscriptions from EVENT_SINKS"

**Done when:**
- The subscription-set test passes and no literal event-type list remains in `OtelVisualizer.start`
- Existing otel-visualizer tests pass unchanged (same 13 types today, so behavior is identical)

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — start() derivation
- src/conductor/test/otel-visualizer.test.ts — subscription-set test

**Dependencies:** 1

### Task 3: Thread the dispatch session id from beginFeatureRun into runConductorInWorktree
**Story:** Story 2 (fresh-worktree negative path — injected id equals the id the runner persists)
**Type:** infrastructure

**Steps:**
1. Write failing test: `beginFeatureRun`'s returned scope exposes a non-empty `sessionId`, and the step runner constructed by `runConductorInWorktree` receives that same id instead of minting its own
2. Verify test fails (RED)
3. Implement: mint the uuid in `beginFeatureRun`, expose it on the returned scope, add a `sessionId` parameter to `runConductorInWorktree` (defaulting to a fresh uuid for existing callers) and pass it to `new DefaultStepRunner(...)` in place of the inline `uuidv4()`
4. Verify test passes (GREEN)
5. Commit with message: "Mint the daemon dispatch session id in beginFeatureRun and thread it to the step runner"

**Done when:**
- The threading test passes: scope.sessionId === the id the DefaultStepRunner was constructed with
- No behavior change for callers that omit the parameter (default preserves today's fresh-uuid path; existing daemon tests pass)

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — beginFeatureRun + runConductorInWorktree signature

**Dependencies:** none

### Task 4: Extract the shared wiring helper wireOtelVisualizer
**Story:** Story 1 (both entry points use one helper)
**Type:** infrastructure

**Steps:**
1. Write failing test: `wireOtelVisualizer(config, ctx, events)` returns null when otel is absent/disabled; returns a started visualizer when enabled (fake OTLP transport); when `ctx.runId` is supplied the resource carries it and no file write occurs under the supplied pipelineDir
2. Verify test fails (RED)
3. Implement: create `src/conductor/src/engine/otel/wire.ts` moving `createOtelVisualizer` (from `src/conductor/src/index.ts:285`) plus a `wireOtelVisualizer` that composes resolveOtelConfig + construction + `start(events)`; re-export `createOtelVisualizer` from index.ts. Follow the audit-trail sink pattern: construct near the owning bus, subscribe, tear down with the owning scope; allowed variation — return-the-plugin instead of subscribe-object, since callers own stop timing
4. Verify test passes (GREEN)
5. Commit with message: "Extract shared wireOtelVisualizer helper into engine/otel/wire.ts"

**Done when:**
- Helper tests pass for disabled-null, enabled-started, and injected-runId/no-write cases
- `createOtelVisualizer` has exactly one definition (in wire.ts) and index.ts re-exports it (existing importers compile)

**Files likely touched:**
- src/conductor/src/engine/otel/wire.ts — new helper module
- src/conductor/src/index.ts — remove moved function, re-export
- src/conductor/test/otel-wire.test.ts — helper tests

**Dependencies:** 2

### Task 5: Interactive entry point calls the shared helper
**Story:** Story 1 (both entry points through the same helper)
**Type:** refactor

**Steps:**
1. Write failing test: the interactive wiring path produces the same visualizer list as before via the helper (drive the extracted seam with an enabled config; assert one started visualizer with the run's pipelineDir/feature/project context and no `ctx.runId` override)
2. Verify test fails (RED)
3. Implement: replace the inline block at `src/conductor/src/index.ts:1279-1296` with a `wireOtelVisualizer` call feeding the existing `visualizerList`/`buildVisualizers`/`stopVisualizers` lifecycle
4. Verify test passes (GREEN)
5. Commit with message: "Route interactive OTel wiring through wireOtelVisualizer"

**Done when:**
- No call to resolveOtelConfig/createOtelVisualizer remains inline in main()'s tail; the helper is the only construction path there
- Existing interactive otel integration tests pass unchanged

**Files likely touched:**
- src/conductor/src/index.ts — main() tail wiring

**Dependencies:** 4

### Task 6: beginFeatureRun wires a per-dispatch visualizer with read-only run id
**Story:** Story 1 (daemon dispatch emits spans/metrics); Story 2 (attribution happy paths and both negative paths)
**Type:** happy-path

**Steps:**
1. Write failing test: with otel enabled, `beginFeatureRun` attaches a visualizer to the feature-scoped bus whose resource carries conductor.feature=slug, conductor.project, and conductor.run.id = existing conduct-session-id content when present, else the scope's sessionId; and no write to conduct-session-id occurs when the file is absent; and an unreadable pipeline dir degrades to the injected id without throwing
2. Verify test fails (RED)
3. Implement: in `beginFeatureRun`, read the worktree's conduct-session-id (read-only, try/catch), call `wireOtelVisualizer` with `ctx.runId` = file content or scope sessionId, pipelineDir = the worktree's pipeline dir, feature = item.slug, project = the daemon's project root; hold the plugin on the scope for Task 7's stop
4. Verify test passes (GREEN)
5. Commit with message: "Wire per-dispatch OTel visualizer in beginFeatureRun"

**Done when:**
- Resource-attribute test passes for both the file-present and file-absent cases
- A filesystem spy/asserted directory listing shows zero writes to conduct-session-id from the wiring path
- The unreadable-pipeline case completes the dispatch scope without throwing

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — beginFeatureRun wiring
- src/conductor/test/daemon-otel-wiring.test.ts — new tests

**Dependencies:** 3, 4

### Task 7: Dispatch-end stop awaits the visualizer flush
**Story:** Story 3 (flush on clean end; HALT/error negative; idempotent stop negative)
**Type:** happy-path

**Steps:**
1. Write failing test: `beginFeatureRun`'s returned stop awaits the visualizer's stop before detaching persistence (fake visualizer records ordering); a dispatch that ends in HALT/thrown error still runs the same stop path and events emitted pre-halt reach the fake exporter; a second stop invocation returns the first stop's promise (no second flush)
2. Verify test fails (RED)
3. Implement: make the scope's `stop` async — `await visualizer?.stop()` then detach renderers and `persistence.stop()`; update every scope-stop call site in the daemon to await it
4. Verify test passes (GREEN)
5. Commit with message: "Await per-dispatch OTel flush in the feature scope stop"

**Done when:**
- Ordering test passes: visualizer stop resolves before persistence detach
- HALT-path test passes: pre-halt events present in exporter output after stop
- Idempotency test passes: two stops, one flush
- All daemon call sites of the scope stop are awaited (no floating promise; lint/type check clean)

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — async scope stop + call sites

**Dependencies:** 6

### Task 8: Disabled or absent OTel leaves the daemon unchanged
**Story:** Story 4 (happy path; invalid-config negative); Story 1 (constructor-throw negative)
**Type:** negative-path

**Steps:**
1. Write failing test: with no otel config, `beginFeatureRun` constructs no visualizer (constructor spy never called) and the scope's event handling matches the pre-change subscription set; with an invalid otel config, resolution yields enabled=false and dispatch proceeds identically; with an enabled config whose visualizer constructor throws, a renderer_error event is emitted, no visualizer attaches, and the dispatch proceeds normally
2. Verify test fails (RED)
3. Implement: (expected mostly satisfied by Task 6's enabled-gate — fix any gap the test exposes, e.g. eager construction or config resolution outside the gate)
4. Verify test passes (GREEN)
5. Commit with message: "Prove disabled OTel changes nothing in daemon dispatch"

**Done when:**
- Disabled-path test passes: zero visualizer constructions, subscription set identical to a build without the feature
- Invalid-config test passes: enabled=false resolution, dispatch completes

**Files likely touched:**
- src/conductor/test/daemon-otel-wiring.test.ts — negative tests
- src/conductor/src/daemon-cli.ts — only if the test exposes a gap

**Dependencies:** 6

### Task 9: Unreachable endpoint degrades to bounded renderer_error warnings
**Story:** Story 4 (unreachable-endpoint negative); Story 3 (hanging-endpoint bounded flush)
**Type:** negative-path

**Steps:**
1. Write failing test: with otel enabled and a transport that fails/hangs, dispatch events produce renderer_error events on the feature bus (bounded via the existing warn-once wrappers, not one per export), the dispatch completes successfully, and the scope stop resolves despite the hanging flush (within the visualizer's existing bounded flush behavior — the warn-once catch on the stop flush path)
2. Verify test fails (RED)
3. Implement: (expected mostly satisfied by the existing onWarning bridge createOtelVisualizer already wires — fix any daemon-path gap, e.g. renderer_error not reaching the feature bus renderer)
4. Verify test passes (GREEN)
5. Commit with message: "Prove unreachable OTLP endpoint degrades to bounded warnings in daemon dispatch"

**Done when:**
- Failing-transport test passes: renderer_error observed on the feature bus, at most one warning per distinct failure (warn-once), dispatch outcome success
- Hanging-flush test passes: scope stop resolves and the daemon loop can proceed

**Files likely touched:**
- src/conductor/test/daemon-otel-wiring.test.ts — degradation tests

**Dependencies:** 7

### Task 10: Cross-path parity guard
**Story:** Story 5 (parity happy path and missing-signal negative); Story 1 (regression negative)
**Type:** negative-path

**Steps:**
1. Write failing test: for every type in `otelEventTypes()`, emit a representative event through the interactive wiring path and through the daemon dispatch wiring path, each with a fake exporter; assert the daemon path observed every signal the interactive path observed, with an assertion message naming any missing event type; prove the negative by temporarily filtering one type from the daemon fake and asserting the test fails naming it
2. Verify test fails (RED) against a deliberately unwired daemon double, then
3. Implement: none expected — this task lands the committed guard; fix any real asymmetry it exposes
4. Verify test passes (GREEN) against the real wiring
5. Commit with message: "Add interactive/daemon OTel parity guard"

**Done when:**
- The parity test is committed, passes against real wiring, and its failure mode names the missing event type
- The existing beginFeatureRun EVENT_SINKS derivation acceptance guard still passes

**Files likely touched:**
- src/conductor/test/acceptance/daemon-otel-parity.acceptance.test.ts — new guard

**Dependencies:** 5, 7

## Task Dependency Graph

```
1 → 2 → 4 → 5 ─┐
3 ──────┬→ 6 → 7 → 9    5,7 → 10
        └──────→ 8
(4 → 6)
```

## Integration Points

- After Task 7: a daemon dispatch against a local OTLP collector emits and flushes a full trace — end-to-end observable.
- After Task 10: the cross-path guard locks the seam.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
