# Implementation Plan: Export the dispatch dimensions the engine already holds

> **Amended 2026-09-10 by operator:** Resolve as-built findings AB-1–AB-4 in
> BUILD. Carry `preferredProvider`, resolved effort, and tier on production
> `provider_attempt` events; retain the latest complete dispatch dimensions for
> failed duration/span closure; preserve the first applicable fallback reason
> across the candidate chain until successful fallback closure. Keep ADR-014's
> single `MetricsListener` architecture by removing the duplicate/dead
> `OtelVisualizer` metric implementation introduced by Tasks 9–10 while keeping
> its span enrichment. Existing tests should assert these production paths, not
> a metrics-enabled visualizer path.

**Date:** 2026-09-09
**Design:** .docs/decisions/architecture-review-2026-09-09-export-the-telemetry-dimensions-the-engine-already.md
**Stories:** .docs/stories/export-the-telemetry-dimensions-the-engine-already.md
**Conflict check:** Clean as of 2026-09-09

## Summary

Thread reasoning effort and complexity tier onto the step close events, make `provider_attempt` a real metrics projection, and put model, effort, provider, tier, and fallback on the step duration/retry/dispatch series and the step span — with `fallbackReason` and `TokenUsage` detail on the span only, per adr-014 D10–D11. Ten tasks.

## Technical Approach

- **One dimension shape, both projections.** A `DispatchDimensions` value (`{ model?, effort?, provider?, tier?, fallback? }`) is built once from an event and passed to `MetricsRecorder.onStepClose`, `onRetry`, and `onDispatch`. The recorder merges only defined members into the data-point attributes (the `feature_cost_snapshot` handling of optional `model`/`source` is the local pattern: copy the "only add the key when the value is defined" trait; do not add `unknown` fallbacks). Both the daemon `MetricsListener` and the interactive `OtelVisualizer` build that value the same way, which is what condition C1 demands.
- **Effort and tier travel on the event.** `ProviderExecutionResult.resolvedEffort` already exists; it is surfaced onto `StepRunResult.effort` at the same spread where `resolvedModel` becomes `model` in `step-runners.ts`, and emitted on `step_completed`/`step_failed` beside `model` in `conductor.ts`. `tier` is read from `state.complexity_tier` at the same emit site. Keys are omitted when undefined.
- **Provider comes through the existing tracker.** `DispatchMeteringTracker.observe` already selects each invoked dispatch once and drops lifecycle rows; `provider_attempt` gains optional `preferredProvider`, and the observation carries it with `fallbackReason`, so `fallback` (= preferred known and ≠ actual) is computable when the dispatch occurs. The daemon listener gets its own tracker instance per feature so the no-op `provider_attempt` handler can call `recorder.onDispatch` exactly as the interactive switch does.
- **Retry dimensions travel on the retry event.** `step_retry` gains optional `model`, `effort`, `provider`, and `tier`, populated from the failed attempt's `StepRunResult` and current run state before the next attempt starts. Both metrics consumers project retries directly from that occurrence; they do not cache later close-event data or buffer retry metrics. The existing `escalatedModel` and `escalatedEffort` remain the separate description of the upcoming attempt.
- **Spans.** `SpanManager` stores the latest `provider_attempt` observation per open step and sets the D10 attributes at close: `conductor.model`, `conductor.effort`, `conductor.provider`, `conductor.provider.preferred`, `conductor.fallback`, `conductor.fallback.reason`, `conductor.complexity_tier`, `conductor.usage.reasoning_output`, `conductor.usage.turns`, `conductor.usage.duration_ms`, `conductor.cost.source`. Numeric members are set only when finite.
- **Sequencing.** Event fields first (Task 1–2), recorder attribute seam (Task 3), then the three metric behaviors (4–6), spans (7–8), parity (9), and the interactive wiring (10).

## Prerequisites

- adr-014 amendment D10–D11 (2026-09-09) is on the spec branch.
- `DispatchMeteringTracker` (`src/conductor/src/engine/dispatch-metering.ts`) and `MetricsListener.METRICS_HANDLERS` exist on main as described in the architecture review.

## Tasks

### Task 1: Surface resolved effort on the step run result
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: in the step-runner test that already asserts `model` is set on the returned result from `resolvedModel`, assert `effort` equals the provider result's `resolvedEffort` and is absent when `resolvedEffort` is undefined
2. Verify test fails (RED)
3. Implement: add `effort?: EffortLevel` to `StepRunResult`; in the runner spread that maps `result.resolvedModel` → `model`, add the same conditional spread for `result.resolvedEffort` → `effort`
4. Verify test passes (GREEN)
5. Commit with message: "Surface resolved effort on StepRunResult"

**Done when:**
- `StepRunResult` declares optional `effort` typed as `EffortLevel`, and the runner's result spread copies `resolvedEffort` into it only when defined
- A step-runner unit test asserts `effort: 'high'` on the result for a provider result with `resolvedEffort: 'high'` and asserts the `effort` key is absent for one without

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — `StepRunResult.effort`
- src/conductor/src/engine/step-runners.ts — result spread
- src/conductor/test/engine/step-runners.test.ts — assertions

**Dependencies:** none

### Task 2: Emit effort and tier on step_completed and step_failed
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: drive a step to completion with a stubbed runner returning `effort: 'high'` under a state whose `complexity_tier` is `M` and assert the emitted `step_completed` carries `effort: 'high'` and `tier: 'M'`; drive a failure and assert `step_failed` carries both; drive a retry and assert `step_retry` carries the currently resolved `model`, `effort`, `provider`, and `tier`; drive events with unresolved dimensions and assert the keys are absent; replay legacy close and retry lines without the new keys through `EventPersister` and `MetricsListener` and assert no throw
2. Verify test fails (RED)
3. Implement: add optional `effort?: EffortLevel` and `tier?: ComplexityTier` to the `step_completed` and `step_failed` members of `ConductorEvent`; add optional `model`, `effort`, `provider`, and `tier` to `step_retry`; populate retry dimensions from the failed `StepRunResult` and current state, keeping the existing `escalatedModel`/`escalatedEffort` fields for the upcoming attempt
4. Verify test passes (GREEN)
5. Commit with message: "Emit effort and tier on step close events"

**Done when:**
- The `step_completed` and `step_failed` union members declare optional `effort` (`EffortLevel`) and `tier` (`ComplexityTier`); `step_retry` declares optional `model`, `effort`, `provider`, and `tier`; `EVENT_SINKS` needs no new row because no new member exists
- A conductor test asserts the emitted `step_completed` and `step_failed` payloads carry `effort` and `tier` when the runner result and state supply them, and carry neither key when they do not
- A replay test feeds a `step_completed` record lacking both keys through `EventPersister` and `MetricsListener.start` and asserts both accept it without throwing

**Files likely touched:**
- src/conductor/src/types/events.ts — two optional fields on two members
- src/conductor/src/engine/conductor.ts — both emit sites
- src/conductor/test/engine/conductor-step-events.test.ts — new assertions

**Dependencies:** 1

### Task 3: Add the dispatch-dimension attribute seam to MetricsRecorder
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: in `metrics.test.ts`, call `onStepClose('build', 10, 0, undefined, undefined, false, { model: 'opus', effort: 'high', provider: 'claude', tier: 'M' })` and assert the duration data point's attribute set is exactly `{ step, model, effort, provider, tier, project, worker, feature }`; call with `{ model: 'opus' }` only and assert no `effort`/`provider`/`tier` keys and no `unknown` value anywhere; assert the closed attribute-name list matches D10
2. Verify test fails (RED)
3. Implement: export `DispatchDimensions` from `metrics.ts`; add a `dimensions?: DispatchDimensions` parameter to `onStepClose`, `onRetry`, and `onDispatch`; a private `withDimensions(attrs, dims)` copies only defined members, mirroring the optional `model`/`source` handling in `onFeatureCostSnapshot`; `onDispatch` also copies `fallback` when it is a boolean
4. Verify test passes (GREEN)
5. Commit with message: "Add dispatch dimensions seam to MetricsRecorder"

**Done when:**
- `metrics.ts` exports `DispatchDimensions` and `MetricsRecorder.onStepClose`, `onRetry`, and `onDispatch` accept it, merging only defined members via one private helper
- `metrics.test.ts` asserts the exact attribute key set on a duration point for a fully populated dimension value and asserts key absence (not `unknown`) for each omitted member
- `metrics.test.ts` asserts no attribute key outside `step, metering, model, effort, provider, tier, fallback` plus identity appears on `conductor.step.duration`, `conductor.step.retries`, or `conductor.step.dispatches`

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — `DispatchDimensions`, helper, three signatures
- src/conductor/test/engine/otel/metrics.test.ts — attribute-set assertions

**Dependencies:** none

### Task 4: Carry preferred provider and fallback reason on the dispatch observation
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing test: in `dispatch-metering.test.ts`, observe a `provider_attempt` with `preferredProvider: 'codex'` and `fallbackReason: 'codex unavailable'` and assert the observation carries both with `provider: 'claude'`; observe a lifecycle row (`invoked: false`) and assert `undefined`
2. Verify test fails (RED)
3. Implement: add optional `preferredProvider` to the `provider_attempt` event and populate it at its emit site; add `preferredProvider?` and `fallbackReason?` to `DispatchMeteringObservation`; populate them in `toObservation` from the attempt when present as non-empty strings
4. Verify test passes (GREEN)
5. Commit with message: "Carry preferred provider and fallback reason on dispatch observations"

**Done when:**
- `provider_attempt` carries optional `preferredProvider`; `DispatchMeteringObservation` declares optional `preferredProvider` and `fallbackReason`, populated by `DispatchMeteringTracker.observe` from that attempt event when non-empty
- `dispatch-metering.test.ts` asserts both fields on the two event shapes and asserts a lifecycle row (`invoked: false`) still yields `undefined`

**Files likely touched:**
- src/conductor/src/engine/dispatch-metering.ts — two fields
- src/conductor/test/engine/dispatch-metering.test.ts — cases

**Dependencies:** none

### Task 5: Record model, effort, provider, and tier on duration and retries from the listener
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: in the listener-based metrics test (extend `no-daemon-level-metrics-queue-depth-halts-and-gate.acceptance.test.ts` or a new `metrics-listener.test.ts`), emit `step_started`, a `provider_attempt` (`provider: 'claude'`, `model: 'opus'`, `invoked: true`, `outcome: 'success'`), and `step_completed` with `model: 'opus'`, `effort: 'high'`, `tier: 'M'`, `actualProvider: 'claude'`; assert the duration point carries `model=opus, effort=high, provider=claude, tier=M`; emit `step_retry` carrying those four dimensions and assert the retries point carries the same four; emit a `step_completed` and a `step_retry` with no dimensions and assert the corresponding keys are absent
2. Verify test fails (RED)
3. Implement: `MetricsListener` keeps a per-feature `DispatchMeteringTracker`; `onStepClose` builds dimensions from the close event, while the `step_retry` handler builds them directly from the retry event and passes them to the recorder
4. Verify test passes (GREEN)
5. Commit with message: "Record dispatch dimensions on step duration and retries"

**Done when:**
- `MetricsListener` derives `DispatchDimensions` from each `step_completed`/`step_failed` or `step_retry` occurrence and passes them to `onStepClose` or `onRetry` without cross-event caching
- A listener test asserts `model`, `effort`, `provider`, `tier` on the duration point and on a subsequent retries point for the same step, and asserts absence of `model` and `provider` when the events carry neither
- A listener test asserts a `step_retry` with no prior `step_started` records a retries point with `step` and identity only and does not throw

**Files likely touched:**
- src/conductor/src/engine/otel/metrics-listener.ts — dimension tracking, tracker, retry handler
- src/conductor/test/engine/otel/metrics-listener.test.ts — new cases

**Dependencies:** 2, 3, 4

### Task 6: Count dispatches with provider and fallback from a real provider_attempt handler
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: in the listener test, emit a `provider_attempt` (`preferredProvider: 'codex'`, `provider: 'claude'`, `invoked: true`, `outcome: 'success'`) and assert exactly one `conductor.step.dispatches` point with `provider=claude`, `fallback=true`, `metering` present; repeat with preferred `claude` and assert `fallback=false`; repeat with no `preferredProvider` and assert `provider` present and no `fallback` key; emit a lifecycle row and assert no dispatch point and no `provider-lifecycle` label value; assert a following completion does not double-count
2. Verify test fails (RED)
3. Implement: replace the `provider_attempt: () => {}` handler with one that runs the event through the feature's `DispatchMeteringTracker` and, on an observation, calls `recorder.onDispatch(step, tokenUsage, model, dimensions)` where `fallback` is `preferredProvider !== undefined ? preferredProvider !== provider : undefined`; `onStepClose` passes `recordDispatch: false` when the tracker already counted the attempt, else counts the compatibility completion (same rule the interactive path uses)
4. Verify test passes (GREEN)
5. Commit with message: "Count dispatches with provider and fallback from provider_attempt"

**Done when:**
- `MetricsListener.METRICS_HANDLERS.provider_attempt` calls `MetricsRecorder.onDispatch` for each observation the tracker returns and never for a lifecycle row
- A listener test asserts one `conductor.step.dispatches` point per dispatch with `provider` and `fallback` set to true or false, asserts `fallback` absent when no preferred provider was recorded, and asserts `provider-lifecycle` never appears as a label value
- A listener test asserts a successful attempt followed by its matching `step_completed` yields exactly one dispatch point

**Files likely touched:**
- src/conductor/src/engine/otel/metrics-listener.ts — real handler, single-count rule
- src/conductor/test/engine/otel/metrics-listener.test.ts — cases

**Dependencies:** 5

### Task 7: Set dispatch dimension and fallback attributes on the step span
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: in `span-manager.test.ts`, open a step, call `onProviderAttempt` with an observation (`provider: 'claude'`, `preferredProvider: 'codex'`, `fallbackReason: 'codex unavailable'`), complete it with `model: 'sonnet'`, `effort: 'medium'`, `tier: 'S'`, `preferredProvider: 'codex'`, `actualProvider: 'claude'`, and assert the exported span carries `conductor.model=sonnet`, `conductor.effort=medium`, `conductor.complexity_tier=S`, `conductor.provider=claude`, `conductor.provider.preferred=codex`, `conductor.fallback=true`, `conductor.fallback.reason='codex unavailable'`; complete a step whose attempt had no `fallbackReason` and assert that key is absent; call `onProviderAttempt` for a step with no open span and assert one warning, no span, no throw
2. Verify test fails (RED)
3. Implement: add `SpanManager.onProviderAttempt(step, observation)` storing the observation on the open step state; in `onStepCompleted`/`onStepFailed` set the D10 attributes from the event fields and the stored observation, each only when defined; wire the `provider_attempt` case in `otel-visualizer.ts` to call it with the tracker's observation
4. Verify test passes (GREEN)
5. Commit with message: "Set dispatch dimension attributes on step spans"

**Done when:**
- `SpanManager.onProviderAttempt` stores the observation on the open step state and `onStepCompleted`/`onStepFailed` set `conductor.model`, `conductor.effort`, `conductor.complexity_tier`, `conductor.provider`, `conductor.provider.preferred`, `conductor.fallback`, and `conductor.fallback.reason` only when each source value is defined
- `span-manager.test.ts` asserts the full attribute set on a fallback dispatch span, asserts `conductor.fallback.reason` absent when no reason was reported, and asserts an attempt for a step with no open span produces one warning and no span
- The `OtelVisualizer` `provider_attempt` case forwards the tracker's observation to `SpanManager.onProviderAttempt`

**Files likely touched:**
- src/conductor/src/engine/otel/span-manager.ts — observation storage, attributes
- src/conductor/src/engine/otel/otel-visualizer.ts — `provider_attempt` case
- src/conductor/test/engine/otel/span-manager.test.ts — cases

**Dependencies:** 2, 4

### Task 8: Export TokenUsage detail as span-only attributes
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: in `span-manager.test.ts`, complete a step whose `tokenUsage` has `reasoningOutput: 1200`, `numTurns: 7`, `durationMs: 84000`, `costSource: 'provider'` and assert `conductor.usage.reasoning_output=1200`, `conductor.usage.turns=7`, `conductor.usage.duration_ms=84000`, `conductor.cost.source=provider`; with `costSource: 'rate-card'` assert `rate-card`; with a Codex-shaped usage (no `durationMs`, no `costSource`) assert both keys absent; with no `tokenUsage` assert none of the five keys; with `reasoningOutput: NaN` assert that key absent. In `metrics.test.ts`, after a full step close with that usage, assert no series carries `fallback.reason`, any `usage.*`, or `cost.source`
2. Verify test fails (RED)
3. Implement: in `onStepCompleted`, set the four usage attributes from `event.tokenUsage` only when the member is present and, for numbers, `Number.isFinite`; touch no metric code path
4. Verify test passes (GREEN)
5. Commit with message: "Export TokenUsage detail on step spans"

**Done when:**
- `SpanManager.onStepCompleted` sets `conductor.usage.reasoning_output`, `conductor.usage.turns`, `conductor.usage.duration_ms`, and `conductor.cost.source` only for present, finite (`Number.isFinite`) members of `event.tokenUsage`
- `span-manager.test.ts` asserts presence for a full usage, absence of `duration_ms`/`cost.source` for a Codex-shaped usage, absence of all five for no usage, and absence of `reasoning_output` for `NaN`
- `metrics.test.ts` asserts that after a step close with full usage no exported metric series carries `fallback.reason`, `usage.reasoning_output`, `usage.turns`, `usage.duration_ms`, or `cost.source`

**Files likely touched:**
- src/conductor/src/engine/otel/span-manager.ts — usage attributes
- src/conductor/test/engine/otel/span-manager.test.ts — cases
- src/conductor/test/engine/otel/metrics.test.ts — span-only guard

**Dependencies:** 7

### Task 9: Prove daemon listener and interactive visualizer emit identical dimension sets
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: extend `otel-visualizer-parity.test.ts` with a fixture sequence (`step_started`, `provider_attempt`, `step_completed` carrying `model`, `effort`, `tier`, `preferredProvider`, `actualProvider`, `tokenUsage`) replayed through `MetricsListener` and through `OtelVisualizer` (metrics enabled) against two in-memory metric exporters; assert per-instrument attribute key/value sets are equal after stripping identity keys for `step.duration`, `step.retries`, `step.dispatches`; replay with `effort`/`tier` removed and assert both omit them; install a recorder whose `onStepClose` throws and assert both paths swallow it and the emitter still delivers the next event
2. Verify test fails (RED)
3. Implement: the interactive `OtelVisualizer` builds the same `DispatchDimensions` from its `pendingDispatch` observation plus the `step_completed` fields and passes it to `onStepClose`/`onDispatch`/`onRetry`; the shared builder lives in `metrics.ts` (`dispatchDimensionsFrom(event, observation)`) and both paths call it
4. Verify test passes (GREEN)
5. Commit with message: "Prove listener and visualizer dimension parity"

**Done when:**
- `metrics.ts` exports one `dispatchDimensionsFrom(event, observation)` builder and both `MetricsListener` and `OtelVisualizer` obtain their `DispatchDimensions` from it
- `otel-visualizer-parity.test.ts` replays one fixture through both paths and asserts equal attribute sets per instrument for duration, retries, and dispatches, and asserts both omit `effort` and `tier` when the fixture lacks them
- `otel-visualizer-parity.test.ts` asserts a throwing recorder is swallowed on both paths and the following event is still delivered

**Files likely touched:**
- src/conductor/src/engine/otel/metrics.ts — `dispatchDimensionsFrom`
- src/conductor/src/engine/otel/metrics-listener.ts — use the builder
- src/conductor/src/engine/otel/otel-visualizer.ts — use the builder
- src/conductor/test/engine/otel-visualizer-parity.test.ts — fixture replay

**Dependencies:** 6, 8

### Task 10: Interactive dispatch recording passes model and dimensions instead of dropping them
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: in `otel-visualizer.test.ts`, drive `provider_attempt` then `step_completed` with `model: 'opus'`, `preferredProvider: 'codex'`, `actualProvider: 'claude'` through a metrics-enabled visualizer and assert the `conductor.step.dispatches` point carries `model=opus`, `provider=claude`, `fallback=true`; assert the duration point carries `model=opus` and `provider=claude`
2. Verify test fails (RED)
3. Implement: in the `OtelVisualizer` `provider_attempt` case and the `SpanManager` `onStepClose` callback, pass `dispatchDimensionsFrom(...)` to `onDispatch` and `onStepClose`; remove the unused `_model` parameter path in `MetricsRecorder.onDispatch` in favour of the dimensions value
4. Verify test passes (GREEN)
5. Commit with message: "Pass dispatch dimensions through the interactive OTel path"

**Done when:**
- The `OtelVisualizer` `provider_attempt` case calls `onDispatch` with a `DispatchDimensions` carrying `model`, `provider`, and `fallback`, and its step-close callback passes the same value to `onStepClose`
- `otel-visualizer.test.ts` asserts `model`, `provider`, and `fallback=true` on the interactive `conductor.step.dispatches` point and `model` and `provider` on the interactive duration point

**Files likely touched:**
- src/conductor/src/engine/otel/otel-visualizer.ts — pass dimensions
- src/conductor/src/engine/otel/metrics.ts — `onDispatch` reads dimensions
- src/conductor/test/engine/otel/otel-visualizer.test.ts — cases

**Dependencies:** 9

## Task Dependency Graph

```
1 ──▶ 2 ──┬──▶ 5 ──▶ 6 ──┐
3 ────────┤              ├──▶ 9 ──▶ 10
4 ────────┼──▶ 7 ──▶ 8 ──┘
          └──────────────┘
```

Tasks 1, 3, 4 start together. Task 2 waits on 1. Task 5 waits on 2, 3, 4. Task 7 waits on 2, 4. Task 9 waits on 6 and 8.

## Integration Points

- After Task 2: `events.jsonl` for any run shows `effort`/`tier` on step close records.
- After Task 6: a daemon-dispatched feature against a local collector shows `provider` and `fallback` on `conductor_step_dispatches_total` and `model`/`effort`/`provider`/`tier` on `conductor_step_duration_milliseconds_*`.
- After Task 8: a Tempo step span carries the full D10 attribute set.
- After Task 10: an interactive `ai-conductor` run exports the same labels as the daemon path.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a step whose invocation resolved `effort: high` and a run whose `complexity_tier` is `M`, when the step completes, then the emitted `step_completed` event carries `effort: 'high'` and `tier: 'M'` | 2 | "carry `effort` and `tier` when the runner result and state supply them" | diff-local |
| Story 1 happy: Given a step whose invocation resolved `effort: low`, when the step fails, then the emitted `step_failed` event carries `effort: 'low'` and the run's tier | 2 | "the emitted `step_completed` and `step_failed` payloads carry `effort` and `tier`" | diff-local |
| Story 1 negative: Given a step whose runner did not resolve an effort (no policy value), when the step completes, then `step_completed` carries no `effort` key at all rather than a placeholder string | 2 | "carry neither key when they do not" | diff-local |
| Story 1 negative: Given a run whose state has no `complexity_tier` yet, when a step completes, then `step_completed` carries no `tier` key rather than a defaulted tier | 2 | "carry neither key when they do not" | diff-local |
| Story 1 negative: Given a pre-existing `events.jsonl` line for `step_completed` with neither `effort` nor `tier`, when the event persister and the metrics listener replay it, then both accept the record and neither throws or drops it | 2 | "asserts both accept it without throwing" | diff-local |
| Story 2 happy: Given a completed `build` step dispatched on `claude` with model `opus`, effort `high`, tier `M`, when the metrics listener records its duration, then the histogram data point carries attributes `step=build`, `model=opus`, `effort=high`, `provider=claude`, `tier=M` alongside the existing identity attributes | 5 | "asserts `model`, `effort`, `provider`, `tier` on the duration point" | diff-local |
| Story 2 happy: Given a `step_retry` for that same step, when the retries counter is incremented, then the data point carries the same `model`, `effort`, `provider`, and `tier` values as the step's duration point | 5 | "on a subsequent retries point for the same step" | diff-local |
| Story 2 negative: Given a completed step whose event carries no `model`, when its duration is recorded, then the data point has no `model` attribute and no `unknown` value is emitted | 3 | "asserts key absence (not `unknown`) for each omitted member" | diff-local |
| Story 2 negative: Given a completed step whose event carries no `actualProvider` and no matched `provider_attempt`, when its duration is recorded, then the data point has no `provider` attribute | 5 | "asserts absence of `model` and `provider` when the events carry neither" | diff-local |
| Story 2 negative: Given a `step_retry` that arrives before any `step_started` for its step, when the retries counter is incremented, then the point carries `step` and identity only and the listener does not throw | 5 | "records a retries point with `step` and identity only and does not throw" | diff-local |
| Story 3 happy: Given a step with preferred provider `codex` whose successful `provider_attempt` came from `claude`, when the dispatch is counted, then the data point carries `provider=claude` and `fallback=true` in addition to the existing `step` and `metering` attributes | 6 | "one `conductor.step.dispatches` point per dispatch with `provider` and `fallback` set to true or false" | diff-local |
| Story 3 happy: Given a step whose preferred and actual provider are both `claude`, when the dispatch is counted, then the data point carries `provider=claude` and `fallback=false` | 6 | "`provider` and `fallback` set to true or false" | diff-local |
| Story 3 negative: Given a `provider_attempt` lifecycle row (`invoked: false`, `provider: 'provider-lifecycle'`), when the metrics listener receives it, then no dispatch is counted and `provider-lifecycle` never appears as a label value | 6 | "asserts `provider-lifecycle` never appears as a label value" | diff-local |
| Story 3 negative: Given a step with no preferred provider recorded (routing inactive), when the dispatch is counted, then the data point carries `provider` but no `fallback` attribute | 6 | "asserts `fallback` absent when no preferred provider was recorded" | diff-local |
| Story 3 negative: Given a successful `provider_attempt` followed by the matching `step_completed` for the same step and provider, when both are observed, then exactly one dispatch is counted, not two | 6 | "yields exactly one dispatch point" | diff-local |
| Story 4 happy: Given a completed step with model `sonnet`, effort `medium`, tier `S`, preferred provider `codex`, actual provider `claude`, when its span closes, then the span carries `conductor.model=sonnet`, `conductor.effort=medium`, `conductor.complexity_tier=S`, `conductor.provider=claude`, `conductor.provider.preferred=codex`, `conductor.fallback=true` | 7 | "asserts the full attribute set on a fallback dispatch span" | diff-local |
| Story 4 happy: Given a `provider_attempt` for that step with `fallbackReason: 'codex unavailable'`, when the span closes, then the span carries `conductor.fallback.reason='codex unavailable'` | 7 | "asserts the full attribute set on a fallback dispatch span" | diff-local |
| Story 4 negative: Given a `provider_attempt` whose `fallbackReason` is absent, when the span closes, then the span has no `conductor.fallback.reason` attribute | 7 | "asserts `conductor.fallback.reason` absent when no reason was reported" | diff-local |
| Story 4 negative: Given a `provider_attempt` for a step with no open span, when the visualizer receives it, then it is a warn-and-no-op and no span is created or thrown | 7 | "produces one warning and no span" | diff-local |
| Story 4 negative: Given a step span, when it closes, then `conductor.fallback.reason` and the `TokenUsage` detail appear on no metric data point (span only) | 8 | "no exported metric series carries `fallback.reason`, `usage.reasoning_output`, `usage.turns`, `usage.duration_ms`, or `cost.source`" | diff-local |
| Story 5 happy: Given a completed step whose `TokenUsage` has `reasoningOutput: 1200`, `numTurns: 7`, `durationMs: 84000`, `costSource: 'provider'`, when the span closes, then the span carries `conductor.usage.reasoning_output=1200`, `conductor.usage.turns=7`, `conductor.usage.duration_ms=84000`, `conductor.cost.source=provider` | 8 | "asserts presence for a full usage" | diff-local |
| Story 5 happy: Given a completed step whose cost came from the rate card, when the span closes, then the span carries `conductor.cost.source=rate-card` | 8 | "asserts presence for a full usage" | diff-local |
| Story 5 negative: Given a Codex dispatch whose `TokenUsage` has no `durationMs` and no `costSource`, when the span closes, then neither `conductor.usage.duration_ms` nor `conductor.cost.source` is present and no zero is written | 8 | "absence of `duration_ms`/`cost.source` for a Codex-shaped usage" | diff-local |
| Story 5 negative: Given a completed step with no `tokenUsage` at all, when the span closes, then no `conductor.usage.*` or `conductor.cost.source` attribute is present | 8 | "absence of all five for no usage" | diff-local |
| Story 5 negative: Given a `TokenUsage` whose `reasoningOutput` is `NaN`, when the span closes, then `conductor.usage.reasoning_output` is omitted | 8 | "absence of `reasoning_output` for `NaN`" | diff-local |
| Story 6 happy: Given one recorded event sequence (`step_started`, `provider_attempt`, `step_completed` with model, effort, tier, providers), when it is replayed through the daemon metrics listener and through the interactive visualizer against two in-memory metric exporters, then the duration, retries, and dispatches data points have identical attribute key/value sets on both paths (identity attributes aside) | 9 | "asserts equal attribute sets per instrument for duration, retries, and dispatches" | diff-local |
| Story 6 negative: Given the same sequence with `effort` and `tier` removed from `step_completed`, when replayed through both paths, then both omit `effort` and `tier` and neither substitutes a default | 9 | "asserts both omit `effort` and `tier` when the fixture lacks them" | diff-local |
| Story 6 negative: Given a metrics handler that throws while merging attributes, when the event is delivered, then the failure is swallowed as best-effort on both paths and the run continues | 9 | "asserts a throwing recorder is swallowed on both paths and the following event is still delivered" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | no-change | none | The exporter stays a bus listener; this feature adds fields at two existing emit sites but subscribes through the same `otelEventTypes()` rows and adds no subscription elsewhere |
| adr-014-otel-observability-exporter#D2 | no-change | none | `visualizer:otel` packaging and registry selection are untouched |
| adr-014-otel-observability-exporter#D3 | existing | none | The `start(emitter, context)` seam shipped in #1516/#1934 (`src/conductor/src/engine/otel/wire.ts`) and is not changed |
| adr-014-otel-observability-exporter#D4 | task | task-3 | merging only defined members via one private helper |
| adr-014-otel-observability-exporter#D5 | task | task-9 | asserts a throwing recorder is swallowed on both paths and the following event is still delivered |
| adr-014-otel-observability-exporter#D6 | no-change | none | Transport selection under `otel:` is untouched; no exporter or endpoint change |
| adr-014-otel-observability-exporter#D7 | existing | none | The daemon-owned meter and single `MetricsListener` shipped in #1937 (`src/conductor/src/engine/otel/wire.ts`, `metrics-listener.ts`); this feature extends its handlers only |
| adr-014-otel-observability-exporter#D8 | no-change | none | `service.instance.id`, `project`, `worker`, and `feature` placement are unchanged; new attributes are data-point labels beside them, never resource attributes |
| adr-014-otel-observability-exporter#D9 | no-change | none | Daemon-level instruments (`conductor.daemon.*`, `feature.*`, `gate.*`) receive no new attribute |
| adr-014-otel-observability-exporter#D10 | task | task-3, task-8 | no attribute key outside `step, metering, model, effort, provider, tier, fallback` plus identity appears on `conductor.step.duration`, `conductor.step.retries`, or `conductor.step.dispatches` |
| adr-014-otel-observability-exporter#D11 | task | task-2, task-6 | The `step_completed` and `step_failed` union members declare optional `effort` (`EffortLevel`) and `tier` (`ComplexityTier`), and `EVENT_SINKS` needs no new row because no new member exists |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [x] Dependencies are explicit and acyclic

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/otel/metrics.ts:195-203 — stop applying `fallback` in the shared `withDimensions` helper for the step-duration and step-retries instruments: derive the per-instrument allowed dimension keys from one source so duration/retries take only model, effort, provider, tier while dispatches additionally takes fallback, keeping the existing onDispatch fallback behaviour that plan Task 6 delivered; this closes all three leaking sites at metrics.ts:109 (duration), metrics.ts:110 (retries via onStepClose) and metrics.ts:127 (retries via onRetry)
**Gate:** as-built
**Rationale:** Verified (95%): ADR-014 D10 permits `fallback` only as an additional label on conductor.step.dispatches, but src/conductor/src/engine/otel/metrics.ts:201 copies `fallback` inside the single `withDimensions` helper, which feeds the duration histogram and retries counter at src/conductor/src/engine/otel/metrics.ts:109-110 and the retries counter again at src/conductor/src/engine/otel/metrics.ts:127; the listener merges a complete dimensions object (including `fallback`) into close attributes at src/conductor/src/engine/otel/metrics-listener.ts:137,163, so a fallback dispatch leaks the label onto duration and retries. Approved architecture is unchanged and authoritative — this is conforming implementation drift, not an architectural question. Class sweep: all three non-dispatch sites are fed by the one helper, so the repair is made there rather than at each call site; the matched-pair counterpart is the closed attribute-name list asserted at src/conductor/test/engine/otel/metrics.test.ts:122, which currently permits `fallback` on all three instruments and is brought along in the same task so the enumeration and the placement contract cannot drift. No coverage is removed: the dispatch-side `fallback` assertions delivered by plan Task 6 at src/conductor/test/engine/otel/metrics-listener.test.ts:113-114 and the fully populated duration/retries assertions delivered by plan Task 3 at src/conductor/test/engine/otel/metrics.test.ts:124-126 both survive unchanged. Found and deliberately excluded: the two stale Mermaid node labels the review names as non-blocking live in a sealed architecture artifact owned by DECIDE, and no active plan task admits editing it, so they are not tasked here. Plan Task 3 was examined and does not admit this remedy — its Done-when explicitly allows `fallback` in the duration/retries key list — so this is appended remediation work rather than an existing-task binding.
**Governing clause:** adr-014-otel-observability-exporter decision 10
**Done when:**
- adr-014-otel-observability-exporter decision 10 is satisfied by this task.

### Task rem-as-built-rem-ab1-2: src/conductor/test/engine/otel/metrics.test.ts:92-131 — extend the existing 'records only defined dispatch dimensions on step metric attributes' case (do not modify its current duration/retries/dispatches expectations) by passing `fallback: true` in the dimensions value and asserting the conductor.step.duration and conductor.step.retries points have no `fallback` key while the conductor.step.dispatches point carries `fallback: true`; replace the single union allowlist at line 122 with per-instrument allowed key lists so the enumeration matches the D10 placement contract instead of permitting fallback everywhere
**Gate:** as-built
**Rationale:** Verified (95%): ADR-014 D10 permits `fallback` only as an additional label on conductor.step.dispatches, but src/conductor/src/engine/otel/metrics.ts:201 copies `fallback` inside the single `withDimensions` helper, which feeds the duration histogram and retries counter at src/conductor/src/engine/otel/metrics.ts:109-110 and the retries counter again at src/conductor/src/engine/otel/metrics.ts:127; the listener merges a complete dimensions object (including `fallback`) into close attributes at src/conductor/src/engine/otel/metrics-listener.ts:137,163, so a fallback dispatch leaks the label onto duration and retries. Approved architecture is unchanged and authoritative — this is conforming implementation drift, not an architectural question. Class sweep: all three non-dispatch sites are fed by the one helper, so the repair is made there rather than at each call site; the matched-pair counterpart is the closed attribute-name list asserted at src/conductor/test/engine/otel/metrics.test.ts:122, which currently permits `fallback` on all three instruments and is brought along in the same task so the enumeration and the placement contract cannot drift. No coverage is removed: the dispatch-side `fallback` assertions delivered by plan Task 6 at src/conductor/test/engine/otel/metrics-listener.test.ts:113-114 and the fully populated duration/retries assertions delivered by plan Task 3 at src/conductor/test/engine/otel/metrics.test.ts:124-126 both survive unchanged. Found and deliberately excluded: the two stale Mermaid node labels the review names as non-blocking live in a sealed architecture artifact owned by DECIDE, and no active plan task admits editing it, so they are not tasked here. Plan Task 3 was examined and does not admit this remedy — its Done-when explicitly allows `fallback` in the duration/retries key list — so this is appended remediation work rather than an existing-task binding.
**Governing clause:** adr-014-otel-observability-exporter decision 10
**Done when:**
- adr-014-otel-observability-exporter decision 10 is satisfied by this task.

### Task rem-as-built-rem-ab1-3: src/conductor/test/engine/otel/metrics-listener.test.ts — add a listener case emitting step_started, a provider_attempt with preferredProvider 'codex' and provider 'claude' (invoked true), a step_retry, and step_completed, asserting the duration and retries points omit `fallback` while the dispatches point keeps `fallback: true`; leave the existing cases at lines 43-75 and 77-115 untouched so their delivered coverage survives
**Gate:** as-built
**Rationale:** Verified (95%): ADR-014 D10 permits `fallback` only as an additional label on conductor.step.dispatches, but src/conductor/src/engine/otel/metrics.ts:201 copies `fallback` inside the single `withDimensions` helper, which feeds the duration histogram and retries counter at src/conductor/src/engine/otel/metrics.ts:109-110 and the retries counter again at src/conductor/src/engine/otel/metrics.ts:127; the listener merges a complete dimensions object (including `fallback`) into close attributes at src/conductor/src/engine/otel/metrics-listener.ts:137,163, so a fallback dispatch leaks the label onto duration and retries. Approved architecture is unchanged and authoritative — this is conforming implementation drift, not an architectural question. Class sweep: all three non-dispatch sites are fed by the one helper, so the repair is made there rather than at each call site; the matched-pair counterpart is the closed attribute-name list asserted at src/conductor/test/engine/otel/metrics.test.ts:122, which currently permits `fallback` on all three instruments and is brought along in the same task so the enumeration and the placement contract cannot drift. No coverage is removed: the dispatch-side `fallback` assertions delivered by plan Task 6 at src/conductor/test/engine/otel/metrics-listener.test.ts:113-114 and the fully populated duration/retries assertions delivered by plan Task 3 at src/conductor/test/engine/otel/metrics.test.ts:124-126 both survive unchanged. Found and deliberately excluded: the two stale Mermaid node labels the review names as non-blocking live in a sealed architecture artifact owned by DECIDE, and no active plan task admits editing it, so they are not tasked here. Plan Task 3 was examined and does not admit this remedy — its Done-when explicitly allows `fallback` in the duration/retries key list — so this is appended remediation work rather than an existing-task binding.
**Governing clause:** adr-014-otel-observability-exporter decision 10
**Done when:**
- adr-014-otel-observability-exporter decision 10 is satisfied by this task.

### Task rem-as-built-rem-ab1-4: Verify RED then GREEN: confirm the new metrics.test.ts and metrics-listener.test.ts assertions fail against the current metrics.ts helper and pass after the rem-ab1-1 change, then run the conductor otel test files
**Gate:** as-built
**Rationale:** Verified (95%): ADR-014 D10 permits `fallback` only as an additional label on conductor.step.dispatches, but src/conductor/src/engine/otel/metrics.ts:201 copies `fallback` inside the single `withDimensions` helper, which feeds the duration histogram and retries counter at src/conductor/src/engine/otel/metrics.ts:109-110 and the retries counter again at src/conductor/src/engine/otel/metrics.ts:127; the listener merges a complete dimensions object (including `fallback`) into close attributes at src/conductor/src/engine/otel/metrics-listener.ts:137,163, so a fallback dispatch leaks the label onto duration and retries. Approved architecture is unchanged and authoritative — this is conforming implementation drift, not an architectural question. Class sweep: all three non-dispatch sites are fed by the one helper, so the repair is made there rather than at each call site; the matched-pair counterpart is the closed attribute-name list asserted at src/conductor/test/engine/otel/metrics.test.ts:122, which currently permits `fallback` on all three instruments and is brought along in the same task so the enumeration and the placement contract cannot drift. No coverage is removed: the dispatch-side `fallback` assertions delivered by plan Task 6 at src/conductor/test/engine/otel/metrics-listener.test.ts:113-114 and the fully populated duration/retries assertions delivered by plan Task 3 at src/conductor/test/engine/otel/metrics.test.ts:124-126 both survive unchanged. Found and deliberately excluded: the two stale Mermaid node labels the review names as non-blocking live in a sealed architecture artifact owned by DECIDE, and no active plan task admits editing it, so they are not tasked here. Plan Task 3 was examined and does not admit this remedy — its Done-when explicitly allows `fallback` in the duration/retries key list — so this is appended remediation work rather than an existing-task binding.
**Governing clause:** adr-014-otel-observability-exporter decision 10
**Done when:**
- adr-014-otel-observability-exporter decision 10 is satisfied by this task.
