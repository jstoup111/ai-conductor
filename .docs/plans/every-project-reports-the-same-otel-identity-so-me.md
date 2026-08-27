# Implementation Plan: OTel two-layer identity

**Date:** 2026-08-26
**Stories:** .docs/stories/every-project-reports-the-same-otel-identity-so-me.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Makes per-project and per-run metric identity exportable without collector rewriting: identity
attributes injected on every metric data point plus `service.instance.id` on the Resource, in
5 tasks.

## Technical Approach

Per the amended adr-014 (2026-08-26): `service.name` stays constant; the resolved run id is
additionally exported as `service.instance.id`; `project` (basename of the project root) and
`feature` become data-point attributes on every instrument, injected at exactly one seam so
instruments added concurrently (#1941's cost/dispatch counters) inherit them automatically.

- `MetricsRecorder` gains a constructor parameter `identityAttrs: { project: string; feature: string }`
  and one private helper that merges it into a per-point attribute object; every
  `record()`/`add()` call site passes through that helper. No call site constructs its attribute
  object inline after this change — that is what makes the seam single.
- `buildResource` (`src/conductor/src/engine/otel/resource.ts`) adds
  `'service.instance.id': runId` to the returned attributes. The run-id resolution chain, the
  never-throws contract, and all four existing `conductor.*` attributes are untouched.
- `OtelVisualizer` computes `identityAttrs` from its context — `project: basename(ctx.project)`
  (node:path) and `feature: ctx.feature` — and passes it to `MetricsRecorder`. `ctx.project`
  continues to receive the project root from the single production construction site
  (`createOtelVisualizer` in `src/conductor/src/index.ts`), which is unchanged.
- Test pattern: extend the existing harness in `src/conductor/test/engine/otel/metrics.test.ts`
  (`makeVisualizer` + `InMemoryMetricExporter` lookup, T15/T16 style) and
  `src/conductor/test/engine/otel/resource.test.ts` (direct `buildResource` assertions). Follow
  those files' existing describe/it shape; allowed variation: direct `MetricsRecorder`
  construction with a test `Meter` where the visualizer path cannot express a case.

Rebase note: #1941 (merged spec, in-flight) adds two counters to `metrics.ts`. If it lands first,
route its counters' attributes through the same merge helper during rebase; the identity seam is
designed so this is mechanical.

## Prerequisites

None — all touched modules exist on main; no new dependencies.

## Tasks

### Task 1: service.instance.id on the Resource
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in the existing resource test file: explicit-runId build yields `service.instance.id` equal to the override while `conductor.run.id` still equals it; session-file path yields the file's trimmed content as `service.instance.id`; minted path (no file) yields a non-empty `service.instance.id`; `service.name` remains exactly `ai-conductor`; `conductor.feature`/`conductor.project` unchanged.
2. Verify tests fail (RED).
3. Implement: add `'service.instance.id': runId` to the attribute object in `buildResource`.
4. Verify tests pass (GREEN), including all pre-existing resource tests unmodified.
5. Commit: "Export run id as service.instance.id on the OTel Resource".

**Done when:**
- The named assertions pass in the resource test file for override, file, and minted paths.
- A passing assertion pins `service.name === 'ai-conductor'` and the four pre-existing `conductor.*` attributes byte-unchanged.
- All pre-existing resource tests pass unmodified.

**Files:**
- src/conductor/src/engine/otel/resource.ts — add service.instance.id attribute
- src/conductor/test/engine/otel/resource.test.ts — instance-id tests

**Dependencies:** none

### Task 2: Resource robustness negatives preserved with instance id
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing (or pinning) tests: with an unwritable pipeline directory, `buildResource` still returns a resource whose `service.instance.id` is non-empty and no exception reaches the caller; a whitespace-only session file falls through to a minted non-empty id.
2. Verify RED/pinning status honestly (the existing never-throws implementation may already satisfy a case — keep it as pinning coverage).
3. Implement any gap.
4. Verify tests pass (GREEN).
5. Commit: "Pin never-throws and minted-id semantics for service.instance.id".

**Done when:**
- The unwritable-directory test passes with no throw and a non-empty `service.instance.id`.
- The whitespace-file test passes with a minted non-empty id.

**Files:** same

**Dependencies:** Task 1

### Task 3: Identity attributes injected at one seam in MetricsRecorder
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in the metrics test file (makeVisualizer harness): after a step_completed close with tokens and a pipeline_closeout event, every exported data point of `conductor.step.duration`, `conductor.step.retries`, `conductor.step.tokens`, and `conductor.pipeline.closeout.duration` carries `project` and `feature` attributes with the injected values, alongside its pre-existing attributes unchanged; two recorder instances with different identity values produce data points with distinct `project` values.
2. Verify tests fail (RED).
3. Implement: add the `identityAttrs` constructor parameter and a private `withIdentity(attrs)` merge helper in `MetricsRecorder`; convert every `record()`/`add()` call site to pass through it. The seam is single: after this change no call site in the class constructs its final attribute object without the helper (diff property).
4. Verify tests pass (GREEN); pre-existing T15/T16 tests updated only where they assert exact attribute sets, with their original keys/values still asserted.
5. Commit: "Inject project/feature identity attributes on every metric data point".

**Done when:**
- Identity-attribute assertions pass for all four existing instruments via the in-memory exporter.
- The two-instance test asserts distinct `project` values.
- The diff shows every `record()`/`add()` call in the recorder routing its attributes through the single merge helper.
- All pre-existing attribute keys and values still assert successfully (additive-only).

**Files:**
- src/conductor/src/engine/otel/metrics.ts — identityAttrs param + merge helper
- src/conductor/test/engine/otel/metrics.test.ts — identity attribute tests

**Dependencies:** none

### Task 4: Run id stays off data points; totals remain aggregable
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing (or pinning) tests: for every exported data point across all instruments in a full-run fixture, no attribute value equals the run id and no attribute key names a run id; summing a counter's data points across two recorder instances with different `project` values yields the arithmetic total (instrument names identical across instances — identity never forks the instrument name).
2. Verify RED/pinning status honestly.
3. Implement any gap (the merge helper must not receive the run id; nothing prefixes instrument names with identity).
4. Verify tests pass (GREEN).
5. Commit: "Pin run id off data points and instrument-name stability".

**Done when:**
- The no-run-id assertion passes over every data point in the fixture.
- The cross-instance sum test passes with identical instrument names.

**Files:** same as Task 3

**Dependencies:** Task 3

### Task 5: Visualizer derives and wires identity end-to-end
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests: driving `createOtelVisualizer` with in-memory exporters, a project path of nested directories, and a feature name yields data points whose `project` equals the path's basename (not the absolute path) and whose `feature` equals the given name; the exported spans and metrics carry the same `service.instance.id` on their resources (one resource, both providers); with feature `unknown`, the data point carries `feature` = `unknown` verbatim.
2. Verify tests fail (RED).
3. Implement: in the `OtelVisualizer` constructor, compute `identityAttrs` as basename of `ctx.project` plus `ctx.feature`, and pass it to `MetricsRecorder`.
4. Verify tests pass (GREEN).
5. Commit: "Derive basename project identity in OtelVisualizer wiring".

**Done when:**
- The end-to-end basename and feature assertions pass through the production construction path.
- The `unknown` passthrough test passes.
- Story 1's basename criterion is covered by this task's end-to-end assertion (coverage note for the mapping).

**Files:**
- src/conductor/src/engine/otel/otel-visualizer.ts — identityAttrs derivation + wiring
- src/conductor/test/engine/otel/otel-visualizer.test.ts — end-to-end identity tests

**Dependencies:** Task 3

## Task Dependency Graph

```
Task 1 ─▶ Task 2
Task 3 ─▶ Task 4
Task 3 ─▶ Task 5
```

## Integration Points

- After Task 5: full identity observable end-to-end — resource instance id (Task 1) + data-point
  identity (Task 3) through the real construction path.

## Verification

- [ ] All Story 1-3 happy-path criteria covered (Tasks 1, 3, 5)
- [ ] All negative-path criteria covered as explicit tasks (Tasks 2, 4) plus Story 3's passthrough negative in Task 5
- [ ] No task exceeds 5 minutes
- [ ] Every task has falsifiable Done-when checks
- [ ] Dependencies explicit and acyclic
