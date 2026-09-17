# Implementation Plan: Feature-scoped OTel metrics carry the complexity tier (#2528)

**Date:** 2026-09-14
**Stories:** .docs/stories/feature-cost-and-shipment-metrics-cannot-be-groupe.md
**Conflict check:** Clean as of 2026-09-14

## Summary

Adds an optional `tier` field to the five feature events and threads it through the single metrics projection so that nine feature-scoped instruments carry an `S|M|L` label, omitted when unresolved, in 8 tasks.

> **Amended 2026-09-15 by #2528:** The approved AB-1 correction expands the scope to seven existing events and adds Task 9 below. It preserves terminal-event ownership of outcomes and makes Task 9 the sole owner of the complete/halt production-order integration proof. Task 6 remains the dispatch-end fallback proof.

## Technical Approach

Per adr-014 D14 (amended 2026-09-14) and the approved component diagram:

- **Five events, one emit site each.** `feature_dispatch_started`, `feature_dispatch_ended`, `feature_shipped`, `feature_usage_total`, and `feature_cost_snapshot` in `src/conductor/src/types/events.ts` each gain `tier?: ComplexityTier`. The three daemon events are emitted once each in `src/conductor/src/engine/daemon-runner.ts` and read `item.tier` — the `BacklogItem` field `daemon-backlog.ts` already parses from the committed `.docs/complexity/<stem>.md` marker (no `.tier ??` fallback exists on that path; the `'M'` fallback in the field comment is applied downstream for step-skip policy only). `feature_usage_total` is emitted once at the `finish` close in `src/conductor/src/engine/conductor.ts` and reads `state.complexity_tier`. `feature_cost_snapshot` is built by `toFeatureCostSnapshot` in `src/conductor/src/engine/cost-rollup.ts` and emitted by `Conductor.emitFeatureCostSnapshot`, which runs on the terminal delivery of a `step_completed`/`step_failed`; it takes that event's already-stamped `tier` so feature and step series cannot disagree and no state read is added.
- **Absence is the raw `undefined`.** Every emit site uses the spread form already used for `step_completed` (search `conductor.ts` for `state.complexity_tier !== undefined && { tier:`): the key is present only when the source is defined. No site may borrow the `?? 'L'` / `?? 'M'` policy resolutions in `conductor.ts` / `step-runners.ts`. Traits to preserve: raw `undefined` propagates; key absent, not empty; allowed variation: a plain optional parameter instead of a spread where the builder is a function.
- **Recorder threads `tier` per feature method, never through identity.** `MetricsRecorder` (`src/conductor/src/engine/otel/metrics.ts`) feature methods — `onFeatureDispatch`, `onFeatureHalt`, `onRunClose`, `onFeatureShipped`, `onFeatureDuration` — take an optional trailing `tier` and merge it into the per-point attributes before `withIdentity`; `onFeatureCostSnapshot` and `onFeatureUsageTotal` read `event.tier` and merge it into every point they record. `identityAttrs` is untouched so `memory.setup`, `gate.*`, `pipeline.closeout.duration`, and the `daemon.*` gauges keep their exact attribute sets. Pattern: `withDimensions` in the same file (merge only defined members); `tier` joins `RESERVED_CONDUCTOR_LABEL_KEYS` so a custom map cannot supply it, mirroring the existing `feature`/`step` strip.
- **Listener passes what the event carries.** `MetricsListener.METRICS_HANDLERS` (`src/conductor/src/engine/otel/metrics-listener.ts`) for the three daemon events pass `event.tier` to every recorder call they make; the cost handlers already pass the whole event. No listener-side cache or inference from step dimensions.
- **Sequencing.** Task 1 (types + daemon sites) and Task 5 (recorder activity methods) are leaves; Task 2 is a verify-only replay proof on Task 1's shapes; Tasks 3–4 are the in-run emit sites; Task 6 wires the listener on Tasks 1 and 5 and owns the daemon-event→data-point boundary proof; Task 7 threads the cost gauges on Task 1; Task 8 closes containment on Tasks 5 and 7.
- **Rebase note.** #2414 (`restore-per-member-telemetry-for-validation-groups`) edits `events.ts`, `metrics.ts`, and `metrics-listener.ts` additively at distinct symbols (parent/member step labels). Both are one-directional additive edits; keep this feature's `tier` parameters trailing and re-run the Task 6 and Task 8 attribute-set assertions after any rebase.
- **Documentation** for the nine instruments' `tier` label and the re-tier query semantics rides the diff in `docs/reference/configuration.md` per architecture-review C4 and is not a plan task.

> **Amended 2026-09-15 by #2528:** The five-event and three-handler statements above are superseded for terminal outcomes: `feature_complete` and `loop_halt` also carry raw run tier, and `closeFeature` passes it to `onRunClose`. No new subscription or channel is required. Task 9 owns the concrete AB-1 behavior repair and the outstanding AB-2 configuration documentation.

## Prerequisites

None — every touched module exists on main; no new dependency.

## Tasks

### Task 1: Daemon feature events carry the backlog item's tier
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in the daemon-runner test file: with a backlog item whose `tier` is `'M'`, a dispatch that halts and a dispatch that ships emit `feature_dispatch_started`, `feature_dispatch_ended`, and `feature_shipped` each carrying `tier: 'M'`; with an item whose `tier` is undefined, all three emitted payloads have no `tier` own-property.
2. Verify tests fail (RED) — the union has no `tier` field and the sites emit none.
3. Implement: add `tier?: ComplexityTier` to the five feature event members of `ConductorEvent`; at the three `daemon-runner.ts` emit sites spread `...(item.tier !== undefined && { tier: item.tier })`, following the `step_completed` spread pattern (raw `undefined` propagates; key absent, never empty; do not use any `?? 'M'`/`?? 'L'` fallback).
4. Verify tests pass (GREEN); all pre-existing daemon-runner tests unmodified.
5. Commit: "Carry the backlog tier on daemon feature events".

**Done when:**
- The daemon-runner test asserts `feature_dispatch_started`, `feature_dispatch_ended`, and `feature_shipped` each carry `tier: 'M'` when the backlog item's tier is `M`, produced by the item-tier spread at each emit site.
- The same test asserts none of the three payloads has a `tier` own-property when the item's tier is undefined, so no policy default reaches an event.
- `ConductorEvent` declares optional `tier` typed `ComplexityTier` on all five feature event members and the project typechecks.

**Files:**
- src/conductor/src/types/events.ts — optional `tier` on the five feature events
- src/conductor/src/engine/daemon-runner.ts — spread `item.tier` at the three emit sites
- src/conductor/test/engine/daemon-runner.test.ts — presence and absence assertions

**Dependencies:** none

### Task 2: Tierless feature events from an older ledger still replay
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a test in the metrics-listener test file that feeds a `feature_dispatch_ended` line with no `tier` (the pre-feature shape) through the event persister's parse path and through `MetricsListener.start` on a bus, asserting neither throws and the listener's `feature_dispatch_ended` handler records `conductor.run.outcomes` for the slug.
2. Verify the test passes as written — the field is optional, so existing behavior already satisfies it (verify-only).
3. Commit with `Task: 2` and `Evidence: skipped existing behavior satisfies the criterion` trailers if no code changed.

**Done when:**
- A metrics-listener test proves a `feature_dispatch_ended` record without `tier` is accepted by the persister and by the listener handler, which still records `conductor.run.outcomes` for it.
- No production file changes for this task.

**Files:**
- src/conductor/test/engine/otel/metrics-listener.test.ts — legacy-shape replay test

**Verify-only:** yes

**Dependencies:** Task 1

### Task 3: The feature usage total carries the run's tier
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in the conductor test file around the `finish`-close path: with `state.complexity_tier = 'S'`, the emitted `feature_usage_total` carries `tier: 'S'`; with no `complexity_tier` on state, the payload has no `tier` own-property.
2. Verify tests fail (RED).
3. Implement: at the single `feature_usage_total` emit in `conductor.ts`, add `...(state.complexity_tier !== undefined && { tier: state.complexity_tier })` beside the `toFeatureUsageTotals(rollup)` spread — the same form the `step_completed` emit already uses.
4. Verify tests pass (GREEN).
5. Commit: "Stamp the run tier on feature_usage_total".

**Done when:**
- The conductor test asserts `feature_usage_total` carries `tier: 'S'` when run state holds `complexity_tier: 'S'`, produced by the state spread at the finish-close emit.
- The same test asserts the payload has no `tier` own-property when state has no `complexity_tier`, and specifically that the value is not `'L'`.

**Files:**
- src/conductor/src/engine/conductor.ts — tier spread at the `feature_usage_total` emit
- src/conductor/test/engine/conductor.test.ts — presence and absence assertions

**Dependencies:** Task 1

### Task 4: The cost snapshot carries the triggering step's tier
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: in the cost-rollup test file, `toFeatureCostSnapshot(rollup, 'L')` returns `tier: 'L'` and `toFeatureCostSnapshot(rollup)` returns no `tier` own-property; in the conductor test file, terminal delivery of a `step_completed` carrying `tier: 'L'` and of a `step_failed` carrying `tier: 'M'` each emit a `feature_cost_snapshot` whose `tier` equals the step event's tier, a `step_completed` without `tier` yields a snapshot with no `tier` own-property, and a tiered `step_completed` whose ledger read fails emits no snapshot and leaves the step verdict unchanged.
2. Verify tests fail (RED).
3. Implement: give `toFeatureCostSnapshot` an optional second parameter `tier?: ComplexityTier` spread into the event only when defined; have `emitFeatureCostSnapshot` accept the closing event's `tier` and pass it through; keep the existing `readErrors > 0` early return so no partial snapshot appears.
4. Verify tests pass (GREEN); pre-existing cost-rollup and conductor tests unmodified.
5. Commit: "Carry the closing step's tier on feature_cost_snapshot".

**Done when:**
- The cost-rollup test asserts `toFeatureCostSnapshot` includes `tier` exactly when its tier argument is defined.
- The conductor test asserts the snapshot emitted by terminal delivery carries the same `tier` as the `step_completed` or `step_failed` that triggered it, and no `tier` own-property when that step event has none.
- The conductor test asserts a tiered step whose ledger read fails emits no `feature_cost_snapshot` and the step result is unchanged, via the existing read-error early return.

**Files:**
- src/conductor/src/engine/cost-rollup.ts — optional `tier` parameter on `toFeatureCostSnapshot`
- src/conductor/src/engine/conductor.ts — pass the closing event's tier into `emitFeatureCostSnapshot`
- src/conductor/test/engine/cost-rollup.test.ts — builder presence/absence assertions
- src/conductor/test/engine/conductor.test.ts — terminal-delivery agreement and read-failure assertions

**Dependencies:** Task 1

### Task 5: Recorder activity and outcome methods accept an optional tier
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in the metrics test file using the in-memory exporter: `onFeatureDispatch('fresh', 'M')` yields a `conductor.feature.dispatches` point with `kind=fresh` and `tier=M`; `onFeatureHalt(haltClass, step, 'L')` and `onRunClose('halted', 'L')` yield `feature.halts` and `run.outcomes` points with `tier=L`; `onFeatureShipped('S')` and `onFeatureDuration(wall, active, 'S')` yield `feature.shipped`, `feature.duration.wall`, and `feature.duration.active` points with `tier=S`; each method called without a tier yields a point with no `tier` attribute; `onFeatureDuration(wall, undefined, 'S')` records a tiered wall point and no active point.
2. Verify tests fail (RED).
3. Implement: add a trailing optional `tier?: string` to the five methods and merge `{ tier }` into the per-point attributes only when defined, before `withIdentity` — the `withDimensions` pattern (merge defined members only); do not touch `identityAttrs`.
4. Verify tests pass (GREEN); pre-existing metrics tests unmodified.
5. Commit: "Accept an optional tier on feature activity and outcome instruments".

**Done when:**
- The metrics test asserts the exact attribute set on `feature.dispatches`, `feature.halts`, `run.outcomes`, `feature.shipped`, `feature.duration.wall`, and `feature.duration.active` points carries `tier` when the method receives one, merged per method before identity.
- The same test asserts each of those points has no `tier` attribute when the method receives none.
- The test asserts a tiered `onFeatureDuration` with an undefined active duration records no active point, so the tier never fabricates an active duration.

**Files:**
- src/conductor/src/engine/otel/metrics.ts — optional `tier` on the five feature methods
- src/conductor/test/engine/otel/metrics.test.ts — attribute-set assertions

**Dependencies:** none

### Task 6: The metrics listener passes the feature event's tier to every recorder call
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in the metrics-listener test file driving a bus with an in-memory exporter: a `feature_dispatch_started` with `tier: 'M'` produces a `feature.dispatches` point with `tier=M`; a halted `feature_dispatch_ended` with `tier: 'L'` produces `feature.halts` and `run.outcomes` points with `tier=L`; a `feature_shipped` with `tier: 'S'`, `runStartedAt`, and `active.state: 'exact'` produces `feature.shipped`, `duration.wall`, and `duration.active` points with `tier=S`; the same three events without `tier` produce points with no `tier` attribute; a `feature_shipped` with `tier: 'S'` and `active.state: 'partial'` produces a tiered wall point and no active point.
2. Verify tests fail (RED).
3. Implement: in the three handlers, pass `event.tier` as the trailing argument of every recorder call (`onFeatureDispatch`, `onRunClose`, `onFeatureHalt`, `onFeatureShipped`, `onFeatureDuration`). No cache, no lookup in `latestDispatchDimensions`.
4. Verify tests pass (GREEN); pre-existing listener tests unmodified.
5. Commit: "Project the feature event tier onto activity and outcome points".

**Done when:**
- The listener test asserts a daemon feature event carrying `tier` reaches the exported data point as a `tier` attribute on all six activity and outcome instruments, through the `METRICS_HANDLERS` entries for the three events.
- The same test asserts the six points have no `tier` attribute when the events carry none.
- The test asserts a tiered partial-active `feature_shipped` yields a tiered wall point and no active point.

**Files:**
- src/conductor/src/engine/otel/metrics-listener.ts — pass `event.tier` in the three feature handlers
- src/conductor/test/engine/otel/metrics-listener.test.ts — bus-to-point assertions

**Dependencies:** Task 1, Task 5

### Task 7: Cost gauges carry the event's tier on every recorded point
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in the metrics test file: `onFeatureCostSnapshot` with `tier: 'M'`, one `byDimension` bucket, and one `tokensByDimension` bucket yields a `feature.cost` point with `cost_complete` and `tier=M` plus `feature.step.cost` and `feature.step.tokens` points each carrying `tier=M` beside `step`/`model`/`source`/`kind`; `onFeatureUsageTotal` with `tier: 'S'` yields a `feature.cost` point with `tier=S`; both events without `tier` yield points with no `tier` attribute; a snapshot with `tier: 'M'` and a non-finite `costUsd` records no `feature.cost` point.
2. Verify tests fail (RED).
3. Implement: in both methods read `event.tier` and merge `{ tier }` into every recorded point's attributes only when defined, before `withIdentity`; keep the existing `Number.isFinite` guards first.
4. Verify tests pass (GREEN); pre-existing metrics tests unmodified.
5. Commit: "Label feature cost gauges with the event tier".

**Done when:**
- The metrics test asserts the `feature.cost` point and every `feature.step.cost` and `feature.step.tokens` point from one tiered snapshot carry `tier`, merged from `event.tier` before identity, and that `onFeatureUsageTotal` with a tier yields a tiered `feature.cost` point.
- The same test asserts no point from an untiered snapshot or usage total has a `tier` attribute.
- The test asserts a tiered snapshot with non-finite `costUsd` records no `feature.cost` point, via the existing finite guard running before the tier merge.

**Files:**
- src/conductor/src/engine/otel/metrics.ts — read `event.tier` in `onFeatureCostSnapshot` and `onFeatureUsageTotal`
- src/conductor/test/engine/otel/metrics.test.ts — cost-point attribute assertions

**Dependencies:** Task 1

### Task 8: Only feature-scoped instruments gain the tier label
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in the metrics test file: a recorder bound to a feature records a tiered `onFeatureShipped('M')` and then `onMemorySetup`, `onGateVerdict`, `onKickback`, `onPipelineCloseout`, and `onDaemonBacklog` — the `feature.shipped` point carries `tier=M` and none of the `memory.setup`, `gate.verdicts`, `gate.kickbacks`, `pipeline.closeout.duration`, or `daemon.*` points has a `tier` key; a recorder constructed with a custom attribute map `{ tier: 'X' }` records `onFeatureShipped()` with no tier and the point has no `tier` key, and records `onFeatureShipped('S')` and the point carries `tier=S`; a tiered `feature.shipped` point's key set equals the untiered key set plus exactly `tier`.
2. Verify tests fail (RED) — the custom `tier` currently survives the reserved-key filter.
3. Implement: add `'tier'` to `RESERVED_CONDUCTOR_LABEL_KEYS` so the constructor strip drops it; confirm `identityAttrs` still carries only `project`/`worker`/`feature`.
4. Verify tests pass (GREEN); pre-existing reserved-key tests unmodified.
5. Commit: "Reserve tier as a conductor-owned label".

**Done when:**
- The metrics test asserts non-feature points recorded by a tier-carrying feature recorder have no `tier` key while the feature point does, because `tier` is merged per method and never placed in `identityAttrs`.
- The test asserts a custom-map `tier` is stripped by the `RESERVED_CONDUCTOR_LABEL_KEYS` filter, so the point carries the conductor tier or nothing.
- The test asserts a tiered feature point's attribute key set equals today's set plus exactly `tier`.

**Files:**
- src/conductor/src/engine/otel/metrics.ts — `tier` in `RESERVED_CONDUCTOR_LABEL_KEYS`
- src/conductor/test/engine/otel/metrics.test.ts — containment assertions

**Dependencies:** Task 5, Task 7

### Task 9: Preserve tier on the first terminal outcome in production event order
**Story:** 3
**Type:** happy-path

**Steps:**
1. Establish RED through the conductor entry point wired to the existing bus, `MetricsListener`, and in-memory exporter: exercise complete and halt paths with resolved run tier, followed by the daemon dispatch-end event in its actual order. Assert the first outcome has the terminal event's tier and the final outcome count is exactly one. Keep providers and external services mocked at their adapters.
2. Add optional `tier?: ComplexityTier` to `feature_complete` and `loop_halt`; stamp raw `state.complexity_tier` in `completeRun` and raw `haltState.complexity_tier` in centralized `emitLoopHalt`. Omit undefined keys, including early halts; do not add policy defaults, extra state reads, or a listener cache.
3. Narrow `closeFeature` to the terminal event variants as needed and pass the terminal event tier to `onRunClose`. Preserve existing dispatch-end duplicate suppression, fallback outcome recording, and halt metric behavior.
4. Prove GREEN for complete/halt production order, interactive terminal-only recording, unresolved state and early halt absence, tierless legacy terminal-event replay, and dispatch-end without a predecessor. Reuse adequate existing fallback tests; do not replace real-order coverage with isolated fabricated dispatch-end events.
5. Correct `docs/reference/configuration.md` for all nine D14 instruments' optional tier labels, unresolved omission, re-tiered cumulative series retaining their old last values, and the `max by (feature, tier)` last-value query with its cross-tier double-count caveat. Commit the behavior, scoped tests, and reference update together.

**Done when:**
- A conductor-entry regression through the real listener/exporter boundary proves complete and halt each produce one outcome bearing their terminal event's tier before dispatch-end, with no second outcome after dispatch-end; halt metrics still record.
- Interactive complete/halt without dispatch-end record tiered outcomes; unresolved state and early halts emit no tier own-property and export no tier attribute; legacy tierless terminal records replay successfully; standalone dispatch-end remains an outcome fallback.
- The configuration reference lists tier on all nine D14 instruments and explains the re-tier last-value query and its historical-tier double counting. Only scoped RED/GREEN checks run here; aggregate validation remains owned by `test_suite`.

**Files:**
- src/conductor/src/types/events.ts — optional terminal event tier
- src/conductor/src/engine/conductor.ts — centralized complete/halt emitters
- src/conductor/src/engine/otel/metrics-listener.ts — terminal outcome tier projection
- src/conductor/test/engine/conductor.test.ts — conductor-entry terminal-order integration proof and emitter absence cases
- src/conductor/test/engine/otel/metrics-listener.test.ts — interactive, legacy replay, and fallback permutations where sufficient existing tests are absent
- docs/reference/configuration.md — nine-instrument labels and re-tier query semantics

**Dependencies:** Task 1, Task 5, Task 6

## Task Dependency Graph

```
Task 1 ─┬─▶ Task 2
        ├─▶ Task 3
        ├─▶ Task 4
        ├─▶ Task 6 ◀─┐
        └─▶ Task 7 ──┼─▶ Task 8
Task 5 ─────────────┘
```

> **Amended 2026-09-15 by #2528:** Task 9 depends on Tasks 1, 5, and 6. It extends the graph above; completed Tasks 1–8 remain intact.

## Integration Points

- After Task 1: every daemon feature event on the bus carries the committed tier; the persisted ledger shape is final.
- After Task 4: both in-run cost events carry a tier that agrees with the step series for the same dispatch.
- After Task 6: a daemon dispatch's tier reaches exported activity and outcome data points end-to-end — the boundary proof for the daemon path.
- After Task 8: the label set is closed exactly as D14 states.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | no-change | none | The exporter remains a bus listener; this feature adds a field to five existing events and subscribes to nothing new |
| adr-014-otel-observability-exporter#D2 | no-change | none | Packaging as the `visualizer:otel` plugin is untouched; no config surface changes |
| adr-014-otel-observability-exporter#D3 | no-change | none | The shared wiring helper and both entry points are untouched; the listener already serves both |
| adr-014-otel-observability-exporter#D4 | no-change | none | Every tier source is already in scope at its emit site; no I/O, awaiting, or per-event iteration is added to any handler |
| adr-014-otel-observability-exporter#D5 | no-change | none | No new failure mode: the finite and read-error guards run before the tier merge and a missing tier omits the key |
| adr-014-otel-observability-exporter#D6 | no-change | none | Transport selection under `otel:` is untouched |
| adr-014-otel-observability-exporter#D7 | task | task-6 | "through the `METRICS_HANDLERS` entries for the three events" |
| adr-014-otel-observability-exporter#D8 | task | task-8 | "never placed in `identityAttrs`" |
| adr-014-otel-observability-exporter#D9 | task | task-6 | "a tiered partial-active `feature_shipped` yields a tiered wall point and no active point" |
| adr-014-otel-observability-exporter#D10 | no-change | none | The step-instrument label set is untouched; `tier` on step points continues to come from `dispatchDimensionsFrom` |
| adr-014-otel-observability-exporter#D11 | task | task-1, task-3, task-4 | "produced by the item-tier spread at each emit site" |
| adr-014-otel-observability-exporter#D12 | no-change | none | `otel.attributes` validation is untouched; `tier` is a conductor-owned key it can never supply |
| adr-014-otel-observability-exporter#D13 | task | task-8 | "stripped by the `RESERVED_CONDUCTOR_LABEL_KEYS` filter" |
| adr-014-otel-observability-exporter#D14 | task | task-5, task-6, task-7 | "merged per method before identity" |

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a backlog item whose committed complexity marker parsed to `M`, when the daemon begins its dispatch, then the emitted `feature_dispatch_started` carries `tier: 'M'` alongside its existing `slug` and `kind` | 1 | "produced by the item-tier spread at each emit site" | diff-local |
| Story 1 happy: Given that same dispatch halts with a halt class and a halting step, when the daemon ends the dispatch, then the emitted `feature_dispatch_ended` carries `tier: 'M'` alongside `outcome`, `haltClass`, and `step` | 1 | "produced by the item-tier spread at each emit site" | diff-local |
| Story 1 happy: Given that same feature ships, when the daemon emits `feature_shipped`, then the event carries `tier: 'M'` alongside `runStartedAt` and `active` | 1 | "produced by the item-tier spread at each emit site" | diff-local |
| Story 1 negative: Given a backlog item with no parseable complexity marker, when the daemon begins its dispatch, then `feature_dispatch_started` carries no `tier` key at all — not `M`, not `L`, not an empty string | 1 | "so no policy default reaches an event" | diff-local |
| Story 1 negative: Given a backlog item with no parseable complexity marker, when the dispatch ends with any outcome, then `feature_dispatch_ended` carries no `tier` key | 1 | "so no policy default reaches an event" | diff-local |
| Story 1 negative: Given a backlog item with no parseable complexity marker, when the feature ships, then `feature_shipped` carries no `tier` key even though the site reads `conduct-state.json` for `runStartedAt` | 1 | "so no policy default reaches an event" | diff-local |
| Story 1 negative: Given a pre-existing `events.jsonl` line for `feature_dispatch_ended` with no `tier`, when the event persister and the metrics listener replay it, then both accept the record and neither throws or drops it | 2 | "is accepted by the persister and by the listener handler" | diff-local |
| Story 2 happy: Given a run whose state holds `complexity_tier: 'S'`, when the `finish` step closes and the feature usage total is emitted, then `feature_usage_total` carries `tier: 'S'` alongside its existing cost and dispatch counts | 3 | "produced by the state spread at the finish-close emit" | diff-local |
| Story 2 happy: Given a `step_completed` that carries `tier: 'L'`, when its terminal delivery triggers the cost snapshot, then the emitted `feature_cost_snapshot` carries `tier: 'L'` — the same value as the step event that triggered it | 4 | "carries the same `tier` as the `step_completed` or `step_failed` that triggered it" | diff-local |
| Story 2 happy: Given a `step_failed` that carries `tier: 'M'`, when its terminal delivery triggers the cost snapshot, then the emitted `feature_cost_snapshot` carries `tier: 'M'` | 4 | "carries the same `tier` as the `step_completed` or `step_failed` that triggered it" | diff-local |
| Story 2 negative: Given a run whose state has no `complexity_tier`, when the usage total is emitted at `finish`, then `feature_usage_total` carries no `tier` key rather than the `L` that skip policy would resolve | 3 | "specifically that the value is not `'L'`" | diff-local |
| Story 2 negative: Given a `step_completed` with no `tier` key, when its terminal delivery triggers the cost snapshot, then `feature_cost_snapshot` carries no `tier` key | 4 | "no `tier` own-property when that step event has none" | diff-local |
| Story 2 negative: Given a `step_completed` with `tier: 'M'` whose ledger read fails, when terminal delivery runs, then no snapshot is emitted at all and the step's verdict is unchanged — the tier does not cause a partial snapshot to appear | 4 | "emits no `feature_cost_snapshot` and the step result is unchanged" | diff-local |
| Story 3 happy: Given a `feature_dispatch_started` with `tier: 'M'` and `kind: 'fresh'`, when the metrics listener records it, then the `conductor.feature.dispatches` point carries `kind=fresh` and `tier=M` alongside the identity attributes | 6 | "reaches the exported data point as a `tier` attribute on all six activity and outcome instruments" | diff-local |
| Story 3 happy: Given a `feature_dispatch_ended` with `tier: 'L'`, `outcome: 'halted'`, a halt class, and a step, when the listener records it, then the `conductor.feature.halts` point carries `haltClass`, `step`, and `tier=L`, and the `conductor.run.outcomes` point carries `outcome=halted` and `tier=L` | 6 | "reaches the exported data point as a `tier` attribute on all six activity and outcome instruments" | diff-local |
| Story 3 happy: Given a `feature_shipped` with `tier: 'S'`, `runStartedAt`, and an exact active duration, when the listener records it, then the `conductor.feature.shipped` point and both `conductor.feature.duration.wall` and `.active` points carry `tier=S` | 6 | "reaches the exported data point as a `tier` attribute on all six activity and outcome instruments" | diff-local |
| Story 3 negative: Given a `feature_dispatch_started` with no `tier` key, when the listener records it, then the `conductor.feature.dispatches` point has no `tier` attribute and no placeholder value | 6 | "the six points have no `tier` attribute when the events carry none" | diff-local |
| Story 3 negative: Given a `feature_dispatch_ended` with no `tier` key that halted, when the listener records it, then neither the `conductor.feature.halts` point nor the `conductor.run.outcomes` point has a `tier` attribute | 6 | "the six points have no `tier` attribute when the events carry none" | diff-local |
| Story 3 negative: Given a `feature_shipped` with `tier: 'S'` whose `active.state` is `partial`, when the listener records it, then the wall histogram point carries `tier=S` and no active-duration point is recorded at all — the tier does not cause a fabricated active duration | 6 | "a tiered partial-active `feature_shipped` yields a tiered wall point and no active point" | diff-local |
| Story 4 happy: Given a `feature_cost_snapshot` with `tier: 'M'`, when the listener records it, then the `conductor.feature.cost` point carries `cost_complete` and `tier=M`, and every `conductor.feature.step.cost` and `conductor.feature.step.tokens` point from the same snapshot carries `tier=M` alongside its existing `step`, `model`, `source`, and `kind` attributes | 7 | "every `feature.step.cost` and `feature.step.tokens` point from one tiered snapshot carry `tier`" | diff-local |
| Story 4 happy: Given a `feature_usage_total` with `tier: 'S'`, when the listener records it, then the `conductor.feature.cost` point carries `tier=S` | 7 | "`onFeatureUsageTotal` with a tier yields a tiered `feature.cost` point" | diff-local |
| Story 4 happy: Given a `step_completed` with `tier: 'M'` for step `build` that flows through terminal delivery into a snapshot, when both the step duration point and the feature cost point are recorded, then both carry `tier=M` | 4 | "carries the same `tier` as the `step_completed` or `step_failed` that triggered it" | diff-local |
| Story 4 negative: Given a `feature_cost_snapshot` with no `tier` key, when the listener records it, then no point from that snapshot has a `tier` attribute | 7 | "no point from an untiered snapshot or usage total has a `tier` attribute" | diff-local |
| Story 4 negative: Given a `feature_usage_total` with no `tier` key, when the listener records it, then the `conductor.feature.cost` point has no `tier` attribute | 7 | "no point from an untiered snapshot or usage total has a `tier` attribute" | diff-local |
| Story 4 negative: Given a `feature_cost_snapshot` with `tier: 'M'` whose `costUsd` is not finite, when the listener records it, then no `conductor.feature.cost` point is recorded — the tier does not cause a non-finite value to be exported | 7 | "a tiered snapshot with non-finite `costUsd` records no `feature.cost` point" | diff-local |
| Story 5 happy: Given a metrics recorder bound to a feature whose events all carry `tier: 'M'`, when `memory_setup`, `gate_verdict`, `kickback`, and `pipeline_closeout` events are recorded for that feature, then none of the resulting `conductor.memory.setup`, `conductor.gate.verdicts`, `conductor.gate.kickbacks`, or `conductor.pipeline.closeout.duration` points carries a `tier` attribute | 8 | "non-feature points recorded by a tier-carrying feature recorder have no `tier` key" | diff-local |
| Story 5 happy: Given the same recorder, when a `daemon_backlog_snapshot` is recorded, then no `conductor.daemon.*` point carries a `tier` attribute | 8 | "non-feature points recorded by a tier-carrying feature recorder have no `tier` key" | diff-local |
| Story 5 negative: Given a recorder constructed with an `otel.attributes` map containing the key `tier`, when any feature event is recorded, then the custom `tier` value is not present on the point and the conductor-owned tier (or its absence) is what the point carries | 8 | "stripped by the `RESERVED_CONDUCTOR_LABEL_KEYS` filter" | diff-local |
| Story 5 negative: Given a feature event with `tier: 'M'`, when it is recorded, then the exported attribute set for that point is exactly today's set plus `tier` — no other new key appears | 8 | "attribute key set equals today's set plus exactly `tier`" | diff-local |

> **Amended 2026-09-15 by #2528:** Architecture coverage: D1 still uses existing subscriptions on the same bus, now with seven enriched events; D14 is additionally implemented by Task 9. Story 3 production-order completion/halt, duplicate suppression, interactive terminal-only, unresolved/early halt, and legacy-terminal replay criteria map to Task 9's Done when checks (lower-layer conductor/listener behavioral proof). The original isolated dispatch-end rows remain fallback coverage under Task 6. AB-2 is owned by Task 9's reference update, not waived.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/task-cli.ts:345-363 runTaskPlanGap — stamp the run's raw complexity tier (the same persisted run-state complexity_tier the centralized emitLoopHalt reads, accepting only S|M|L) on the appended loop_halt as an own-property only when resolved, omitting the key when unresolved or the state is unreadable, with no policy default; keep the HALT marker write, haltClass plan-gap, and return code unchanged
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift under already-amended adr-014 D14 and Task 9 (terminal halt outcome must bear the run tier): the only other production loop_halt producer, runTaskPlanGap at src/conductor/src/engine/task-cli.ts:358-363, appends a tierless event that CloseoutEventTail (closeout-tail.ts:108-137, started at conductor.ts:8914-8921) projects unchanged, so metrics-listener.ts:114-123 records a tierless outcome and suppresses the centralized tier-bearing halt (conductor.ts:5338) and dispatch-end; D14 already decides the behavior (raw run tier, omitted when unresolved), so the fix is a code+test change, not an architecture decision. Sweep: grep of `type: 'loop_halt'` / `type: 'feature_complete'` finds exactly conductor.ts:5313, conductor.ts:5339, and task-cli.ts:359, and build-review-cli.ts/closeout-cli.ts append no terminal events, so the task-cli site is the whole class. Matched pair: the TaskPlanGapExternalEvent type (closeout-events.ts:14) derives from the loop_halt union member in types/events.ts, which already carries optional tier, so no second vocabulary changes. Preservation: Task 9's existing centralized complete/halt production-order regression (conductor.test.ts:213-248), legacy tierless replay, interactive, early-halt absence, and dispatch-end fallback tests stay and are extended, not replaced. Found-and-excluded: the feature's approved component/terminal-sequence diagram omission is a sealed DECIDE artifact that BUILD cannot amend; it is not tasked here and stays with the as-built re-run.
**Governing clause:** adr-014-otel-observability-exporter D14
**Done when:**
- adr-014-otel-observability-exporter D14 is satisfied by this task.

### Task rem-as-built-rem-ab1-2: src/conductor/test/engine/conductor.test.ts (Task 9 production-order block near :213-248, extend alongside existing cases) — add a RED-first regression that runs a BUILD step with a real CloseoutEventTail, bus, MetricsListener, and in-memory exporter, has the mocked build provider invoke the task-cli plan-gap path while still active across a tail poll, then lets the centralized halt and dispatch-end follow; assert exactly one conductor.run.outcomes point carrying the run tier; add a task-cli unit case (src/conductor/test/engine/task-cli.test.ts) proving the appended loop_halt has tier when state resolves it and no tier own-property when unresolved
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift under already-amended adr-014 D14 and Task 9 (terminal halt outcome must bear the run tier): the only other production loop_halt producer, runTaskPlanGap at src/conductor/src/engine/task-cli.ts:358-363, appends a tierless event that CloseoutEventTail (closeout-tail.ts:108-137, started at conductor.ts:8914-8921) projects unchanged, so metrics-listener.ts:114-123 records a tierless outcome and suppresses the centralized tier-bearing halt (conductor.ts:5338) and dispatch-end; D14 already decides the behavior (raw run tier, omitted when unresolved), so the fix is a code+test change, not an architecture decision. Sweep: grep of `type: 'loop_halt'` / `type: 'feature_complete'` finds exactly conductor.ts:5313, conductor.ts:5339, and task-cli.ts:359, and build-review-cli.ts/closeout-cli.ts append no terminal events, so the task-cli site is the whole class. Matched pair: the TaskPlanGapExternalEvent type (closeout-events.ts:14) derives from the loop_halt union member in types/events.ts, which already carries optional tier, so no second vocabulary changes. Preservation: Task 9's existing centralized complete/halt production-order regression (conductor.test.ts:213-248), legacy tierless replay, interactive, early-halt absence, and dispatch-end fallback tests stay and are extended, not replaced. Found-and-excluded: the feature's approved component/terminal-sequence diagram omission is a sealed DECIDE artifact that BUILD cannot amend; it is not tasked here and stays with the as-built re-run.
**Governing clause:** adr-014-otel-observability-exporter D14
**Done when:**
- adr-014-otel-observability-exporter D14 is satisfied by this task.

> **Amended 2026-09-17 by operator (as-built AB-2 resolution — comply with adr-2026-08-11-halt-events-ride-the-persisted-spine D2):** Tasks rem-as-built-rem-ab1-1 and rem-as-built-rem-ab1-2 required a pipeline-owned `loop_halt` appended by `runTaskPlanGap`, which contradicts D2's single conductor-owned `loop_halt` emitter. The operator chose ADR compliance over a superseding ADR. Their delivered tier stamping and tests are superseded by Tasks rem-as-built-rem-ab2-1 and rem-as-built-rem-ab2-2, which remove the external terminal producer so the centralized `emitLoopHalt` is the only plan-gap `loop_halt` source. This also resolves AB-1 (no `engine-state.json` tier read remains) and makes the approved terminal-sequence diagram accurate without a new ADR.

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/task-cli.ts runTaskPlanGap — delete the appended `loop_halt` closeout event and the `engine-state.json` `complexity_tier` read, keeping the classified plan-gap HALT marker write, the `activePlanPath` read, the operator diagnostics, and return code 1 unchanged; delete `TaskPlanGapExternalEvent` from src/conductor/src/engine/closeout-events.ts and the `ExternalPipelineEvent` union; rewrite the task-cli plan-gap tests to assert the HALT marker is written, the plan is preserved, and `.pipeline/pipeline-events.jsonl` gains no `loop_halt` record, deleting the tier-stamping and tier-omission cases
**Story:** 3
**Gate:** as-built
**Rationale:** DESIGN finding AB-2 (operator resolution 2026-09-17): adr-2026-08-11-halt-events-ride-the-persisted-spine D2 requires one conductor-owned `loop_halt` emit path with every emit site routed through it. `runTaskPlanGap` is the only other producer; the conductor already writes the centralized halt when the build stalls on the classified marker, so the pipeline-owned event is a duplicate terminal seam rather than missing behaviour. Removing it makes the centralized tier-bearing halt the single `conductor.run.outcomes` source for a plan-gap halt.
**Governing clause:** adr-2026-08-11-halt-events-ride-the-persisted-spine D2
**Done when:**
- `grep -rn "type: 'loop_halt'" src/conductor/src` matches only conductor.ts emit sites reached through `emitLoopHalt`; task-cli.ts contains no `appendCloseoutEvent` call and closeout-events.ts contains no `TaskPlanGapExternalEvent`.
- A task-cli unit test proves a plan-gap report writes the classified HALT marker, preserves the plan, returns 1, and appends no record to `.pipeline/pipeline-events.jsonl`.

### Task rem-as-built-rem-ab2-2: src/conductor/test/engine/conductor.test.ts (Task 9 production-order block) — replace the case "keeps a plan-gap halt tiered when the build tail projects it before the centralized halt" with a regression that runs a BUILD step whose mocked provider reports a plan gap through the task-cli path while a real CloseoutEventTail, bus, MetricsListener, and in-memory exporter are active, then lets the centralized halt (tier read from the real persisted `complexity_tier` in `conduct-state.json`, not a fabricated `engine-state.json` fixture) and dispatch-end follow; assert exactly one `conductor.run.outcomes` point and that it carries the run tier
**Story:** 3
**Gate:** as-built
**Rationale:** Same AB-2 resolution: once the external producer is gone, the proof that a plan-gap halt yields one tiered outcome must come from the production emitter and production state, so the regression that pinned the removed seam is replaced rather than deleted. Task 9's existing complete/halt production-order, interactive, early-halt, and legacy-replay cases stay unchanged.
**Governing clause:** adr-2026-08-11-halt-events-ride-the-persisted-spine D2
**Done when:**
- The replaced regression proves exactly one tiered `conductor.run.outcomes` point for a task-cli plan-gap halt with the closeout tail polling, and the test writes no `engine-state.json` fixture.
- The Task 9 production-order, interactive, early-halt, and legacy tierless replay cases still pass unchanged.
