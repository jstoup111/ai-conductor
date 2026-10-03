# Implementation Plan: Trace provenance — commit, base, PR, and originating issue (#2000)

**Date:** 2026-10-02
**Stories:** .docs/stories/a-trace-cannot-be-tied-to-the-commit-pr-or-issue-t.md
**Conflict check:** Clean as of 2026-10-02

## Summary

Exported traces gain the commit a run built, the base it was built against, the pull request it opened with an explicit disposition, and the originating tracker issue, each behind a default-on `otel.provenance` toggle. The plan has 10 tasks.

## Technical Approach

- **Provenance rides existing events (adr-014 D18).** `feature_complete` and `loop_halt` gain optional `headSha`, `baseSha`, and `prDisposition`; `rebase_noop` and `rebase_changed` gain `baseSha` (`rebase_mergeable_skip` already has it). Values are resolved at the emit sites — `completeRun`, the centralized `emitLoopHalt`, and `emitRebaseEvent` — never in a projection (D4).
- **Base survives across steps through conduct state.** The conductor records the latest non-null rebase base in `ConductState.rebase_base_sha`, so a terminal event long after the rebase still carries it.
- **PR disposition is a closed enum.** A pure helper maps PR URL plus the finish-choice marker to `opened`, `none` (`keep`), or `unrecorded`, so "no PR" and "PR not recorded" are distinct and the invalid "none but URL present" state cannot be produced.
- **Placement (D19).** The source ref is resolved once at run start in `index.ts` from the intake marker and lands on the trace Resource, so closed step spans of a crashed run still carry it. Commit, base, and PR are close-time values stamped on the `conductor.run` root span by `SpanManager`; the base also lands on the rebase step span. `OtelVisualizer` does not route rebase events today; Task 9 adds that routing and owns the integration proof through the production visualizer.
- **Config (D20).** `otel.provenance.{commit,pr,issue,feature}` resolves once in `resolveOtelConfig`, all default true; invalid shapes disable OTel with a named error like an unknown exporter. Toggles govern export only; persisted events are never filtered. `feature: false` changes only the trace Resource identity.
- **Local pattern basis.** Terminal-event dimension plumbing follows the #2528 `tier` precedent: optional field, conditional spread at the two centralized terminal seams, omitted when unresolved. Rediscover via `completeRun`, `emitLoopHalt`, and the `tier` spread in each. Allowed variation: these fields are span-only, never data-point labels.
- **Sequencing.** Event types and helpers first (Tasks 1–2, 6, 7 independent), then emit seams serialized on `conductor.ts` (3 → 4 → 5), then the OTel projection (8 → 9 → 10).

## Prerequisites

- None. ADR-014 Decisions 18–20 are approved on the spec branch.

## Tasks

### Task 1: Provenance fields on the event union and conduct state
**Story:** 1
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write a failing replay test in `src/conductor/test/engine/event-persister.test.ts`: feed `feature_complete`, `loop_halt`, `rebase_noop`, and `rebase_changed` lines that carry none of the new fields through `EventPersister` and a `MetricsListener` subscribed to the same emitter; assert neither throws and every record is persisted and observed.
2. Verify RED (the test file references the new exported `RunPrDisposition` type, so it fails to compile).
3. Implement in `src/conductor/src/types/events.ts`: export `RunPrDisposition` as the closed union of `opened`, `none`, `unrecorded`; add optional `headSha?: string`, `baseSha?: string`, `prDisposition?: RunPrDisposition` to `feature_complete` and `loop_halt`; add optional `baseSha?: string or null` (TypeScript `string | null`) to `rebase_noop` and `rebase_changed`. In `src/conductor/src/types/state.ts` add optional `rebase_base_sha?: string` to `ConductState` with a doc comment naming adr-014 D18. Pattern: the optional `tier` field #2528 added to the same two terminal events (search `tier?: ComplexityTier` in `types/events.ts`); keep every new field optional so historical ledgers stay valid.
4. Verify GREEN and commit.

**Done when:**
- `feature_complete` and `loop_halt` in the `ConductorEvent` union declare optional `headSha`, `baseSha`, and `prDisposition` fields, with `prDisposition` typed as the exported `RunPrDisposition` closed set of `opened`, `none`, and `unrecorded`.
- `rebase_noop` and `rebase_changed` declare an optional `baseSha` typed as a string or null, and `ConductState` declares an optional `rebase_base_sha` string.
- A replay test in `event-persister.test.ts` feeds pre-existing `feature_complete`, `loop_halt`, `rebase_noop`, and `rebase_changed` lines carrying none of the new fields through `EventPersister` and `MetricsListener` and asserts both accept every record without throwing and neither drops any record.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/types/state.ts; src/conductor/test/engine/event-persister.test.ts

**Dependencies:** none

### Task 2: Pure run-provenance helpers: PR disposition and HEAD resolution
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/run-provenance.test.ts` for `resolvePrDisposition({ prUrl, finishChoice })` (URL present gives `opened`; no URL with finish choice `keep` gives `none`; no URL with any other or absent finish choice gives `unrecorded`) and for `resolveHeadSha(git)` with a stubbed git runner (success, non-zero exit, and empty stdout).
2. Verify RED.
3. Implement `src/conductor/src/engine/run-provenance.ts` exporting both functions. `resolveHeadSha` runs `git rev-parse HEAD` through the injected runner and never throws. Read the finish choice with the existing `FINISH_CHOICE_MARKER` reader in `engine/artifacts.ts` (search `FINISH_CHOICE_MARKER`); do not add a second parser.
4. Verify GREEN and commit.

**Done when:**
- `resolvePrDisposition` returns `opened` when a PR URL is present, `none` when no PR URL is present and the finish choice is `keep`, and `unrecorded` otherwise, as asserted in `run-provenance.test.ts`.
- `resolveHeadSha` returns the trimmed stdout of `git rev-parse HEAD` and returns `undefined` without throwing when the git call exits non-zero or prints nothing.

**Files:** src/conductor/src/engine/run-provenance.ts; src/conductor/test/engine/run-provenance.test.ts

**Dependencies:** none

### Task 3: completeRun stamps provenance on feature_complete
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-terminal-marker.test.ts` driving `completeRun` with a stubbed git runner and a captured event emitter: (a) HEAD `H`, `state.rebase_base_sha` `B`, `state.pr_url` set; (b) finish-choice marker `keep`, no `pr_url`; (c) HEAD resolution fails; (d) no `rebase_base_sha`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts` `completeRun`: resolve `headSha` with `resolveHeadSha`, read `state.rebase_base_sha`, compute `prDisposition` with `resolvePrDisposition`, and spread each key only when defined. Also change the existing `prUrl: state.pr_url` to an omitted key when undefined. Pattern: the conditional `tier` spread already in `completeRun` (D14 precedent); keep the stamp at this single seam. A provenance failure must never block the completion or the DONE marker.
4. Verify GREEN and commit.

**Done when:**
- `completeRun` emits `feature_complete` with `headSha` from `resolveHeadSha`, `baseSha` from `state.rebase_base_sha`, the existing `prUrl`, and `prDisposition` from `resolvePrDisposition`, as asserted in `conductor-terminal-marker.test.ts` for a run with HEAD `H`, base `B`, and a recorded PR URL yielding `prDisposition: 'opened'`.
- For a run whose finish-choice marker records `keep` and whose state has no `pr_url`, the emitted `feature_complete` carries `prDisposition: 'none'` and has no `prUrl` key.
- When HEAD resolution fails, `feature_complete` is still emitted with no `headSha` key and the daemon DONE marker is still written.
- When `state.rebase_base_sha` is unset, the emitted `feature_complete` has no `baseSha` key and no placeholder value.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-terminal-marker.test.ts

**Dependencies:** Tasks 1, 2

### Task 4: emitLoopHalt stamps provenance on loop_halt
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-terminal-marker.test.ts` driving the centralized `emitLoopHalt` path: (a) halt after a rebase recorded `rebase_base_sha` `B` with HEAD `H`; (b) halt with no PR URL and no `keep` finish choice; (c) halt with no `rebase_base_sha`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/conductor.ts` `emitLoopHalt`: stamp `headSha`, `baseSha` from `this.haltState.rebase_base_sha`, and `prDisposition` exactly as Task 3 does, and omit `prUrl` when undefined. Pattern: the conditional `tier` spread already in `emitLoopHalt`; stamp only at this centralized seam (adr-2026-08-11 D2), never at individual halt callers.
4. Verify GREEN and commit.

**Done when:**
- The centralized `emitLoopHalt` emits `loop_halt` with `headSha` from `resolveHeadSha`, `baseSha` from the halting state's `rebase_base_sha`, and `prDisposition` from `resolvePrDisposition`, as asserted for a halt after a rebase that recorded base `B`.
- A halt with no PR URL and no `keep` finish choice emits `loop_halt` with `prDisposition: 'unrecorded'` and no `prUrl` key.
- A halt whose state has no `rebase_base_sha` emits `loop_halt` with no `baseSha` key and no placeholder value.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-terminal-marker.test.ts

**Dependencies:** Task 3

### Task 5: Rebase outcomes carry the resolved base and the conductor records it
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/rebase.test.ts`: a branch already current with base tip `B`, a code-changing clean rebase onto `B`, a mergeable skip against `B`, and an unresolvable base; assert the emitted event for each. Add a conductor test asserting `state.rebase_base_sha` after the rebase step emits a non-null and then a `null` base.
2. Verify RED.
3. Implement in `src/conductor/src/engine/rebase.ts`: add `baseSha: string | null` to the `noop` and `changed` `RebaseOutcome` kinds, populated from the base the rebase already resolved (search `resolveBaseCore`), and pass it through `emitRebaseEvent` onto `rebase_noop` and `rebase_changed`; leave `rebase_mergeable_skip` byte-identical. In `src/conductor/src/engine/conductor.ts`, at the two conductor `emitRebaseEvent` call sites, set `state.rebase_base_sha` when the outcome carries a non-null `baseSha`.
4. Verify GREEN and commit.

**Done when:**
- The `noop` and `changed` `RebaseOutcome` kinds carry the `baseSha` the rebase resolved, and `emitRebaseEvent` puts it on `rebase_noop` and `rebase_changed` while `rebase_changed` keeps its `changedPaths` and `allChangedPaths`, as asserted in `rebase.test.ts` for a current branch and a code-changing clean rebase against base tip `B`.
- `emitRebaseEvent` emits `rebase_mergeable_skip` with the same `baseRef`, `baseSha`, and `baseKind` it emits today.
- When the base tip cannot be resolved, the outcome event carries `baseSha: null` and the outcome kind and every other field equal the resolvable case.
- After the conductor's rebase step emits an outcome with a non-null `baseSha`, `state.rebase_base_sha` holds that value, and an outcome with `baseSha: null` leaves the previous value in place.

**Files:** src/conductor/src/engine/rebase.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/rebase.test.ts

**Dependencies:** Tasks 1, 4

### Task 6: otel.provenance config resolution and validation
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/otel-config.test.ts`: absent block, each key false, `commit: "no"`, unknown key `branch`, and scalar `provenance: true`.
2. Verify RED.
3. Implement: add `provenance?: { commit?: boolean; pr?: boolean; issue?: boolean; feature?: boolean }` to `OtelConfig` in `src/conductor/src/types/config.ts`; add `provenance` to `CONFIG_CONSUMER_KEY_SETS.otel` in `src/conductor/src/engine/config.ts`; in `src/conductor/src/engine/otel/otel-config.ts` resolve a `ResolvedOtelProvenance` with all four keys defaulting to true and carry it on both enabled `ResolvedOtelConfig` variants. Invalid shapes return `enabled: false` with an `error`, following the unknown-exporter branch in `resolveOtelConfig`. Declare the production consumer in `src/conductor/test/engine/config-consumer-registry.ts`.
4. Verify GREEN and commit.

**Done when:**
- `resolveOtelConfig` resolves an absent `otel.provenance` block to `provenance` with `commit`, `pr`, `issue`, and `feature` all true on `ResolvedOtelConfig`, as asserted in `otel-config.test.ts`.
- `otel.provenance.commit: "no"` resolves to `enabled: false` with an error naming `otel.provenance.commit` and the expected boolean type.
- `otel.provenance.branch: true` resolves to `enabled: false` with an error naming the unknown key `otel.provenance.branch`, and `otel.provenance: true` resolves to `enabled: false` with an error naming `otel.provenance`.
- `CONFIG_CONSUMER_KEY_SETS.otel` includes `provenance`, `OtelConfig` declares it, and `config-consumer-registry.ts` declares its production consumer.

**Files:** src/conductor/src/types/config.ts; src/conductor/src/engine/config.ts; src/conductor/src/engine/otel/otel-config.ts; src/conductor/test/engine/otel/otel-config.test.ts; src/conductor/test/engine/config-consumer-registry.ts

**Dependencies:** none

### Task 7: Resolve the originating source ref into the run start context
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/integration/visualizer-selection.test.ts` for `resolveRunSourceRef(projectRoot, featureDesc)` and `createVisualizerStartContext`: intake marker with `Source-Ref: jstoup111/ai-conductor#2000`; no intake marker; unresolvable plan path; and a `Source-Ref:` line with no value followed by another line.
2. Verify RED.
3. Implement `resolveRunSourceRef` in `src/conductor/src/engine/run-provenance.ts` using `resolveFeaturePlanPath` and `parseIntakeSourceRef` from `engine/artifacts.ts`, exactly as `createFinishPresentationRepair` does (search `parseIntakeSourceRef(await readFile`). Guard the empty-value case so a following line is never captured. Add optional `sourceRef` to `VisualizerStartContext` in `src/conductor/src/types/plugin.ts` and pass it from the `createVisualizerStartContext` call in `src/conductor/src/index.ts`. Never throw from start-context construction.
4. Verify GREEN and commit.

**Done when:**
- `createVisualizerStartContext` carries `sourceRef` resolved by `resolveRunSourceRef`, which reads the intake marker of the plan `resolveFeaturePlanPath` returns and applies `parseIntakeSourceRef`, as asserted in `visualizer-selection.test.ts` for a feature whose intake marker carries `Source-Ref: jstoup111/ai-conductor#2000`.
- `resolveRunSourceRef` returns `undefined` without throwing when the feature has no intake marker, when its plan path cannot be resolved, and when the `Source-Ref:` line is empty, and in each case the run start context is still constructed with no `sourceRef`.

**Files:** src/conductor/src/engine/run-provenance.ts; src/conductor/src/types/plugin.ts; src/conductor/src/index.ts; src/conductor/test/integration/visualizer-selection.test.ts

**Dependencies:** Task 2

### Task 8: Trace Resource carries the source ref and honours the issue and feature toggles
**Story:** 3
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/resource.test.ts` (source ref present, empty, toggle off, metrics signal; feature toggle off for traces and metrics) and an `OtelVisualizer` test in `src/conductor/test/engine/otel/otel-visualizer.test.ts` with an in-memory exporter that ends one step, calls `forceFlush`, and inspects exported spans before `stop()`. Extend `src/conductor/test/engine/otel/metrics-listener.test.ts` to compare step-metric labels with the feature toggle on and off.
2. Verify RED.
3. Implement: `ResourceContext` gains `sourceRef` and `provenance`; `buildResource` in `src/conductor/src/engine/otel/resource.ts` sets `conductor.source.ref` for traces only and, when `feature` is off, drops `conductor.feature` and builds `service.instance.id` from the project name and run id. `OtelVisualizer.initializeProviders` in `src/conductor/src/engine/otel/otel-visualizer.ts` passes `sourceRef` and the resolved provenance. The metric Resource branch is untouched.
4. Verify GREEN and commit.

**Done when:**
- `buildResource` for the traces signal sets `conductor.source.ref` only when `sourceRef` is a non-empty string and `provenance.issue` is true, and the metrics signal never sets it, as asserted in `resource.test.ts`.
- With OTel enabled and no `otel.provenance` config, `provenance.issue` defaults to true and the trace Resource built for a run with `sourceRef` `jstoup111/ai-conductor#2000` carries `conductor.source.ref` equal to `jstoup111/ai-conductor#2000`, as asserted in `resource.test.ts`.
- With `provenance.feature` false, the trace Resource has no `conductor.feature` attribute and its `service.instance.id` is the project name, a slash, and the run id.
- With `provenance.feature` false, the metric Resource attributes and every step-metric data-point `feature` label equal those recorded with the toggle on, as asserted in `resource.test.ts` and `metrics-listener.test.ts`.
- An `OtelVisualizer` test with an in-memory exporter starts a run with `sourceRef` set, ends one step, and after `forceFlush` and before `stop()` asserts the exported closed step span's Resource carries `conductor.source.ref` while no `conductor.run` span has been exported.

**Files:** src/conductor/src/engine/otel/resource.ts; src/conductor/src/engine/otel/otel-visualizer.ts; src/conductor/test/engine/otel/resource.test.ts; src/conductor/test/engine/otel/otel-visualizer.test.ts; src/conductor/test/engine/otel/metrics-listener.test.ts

**Dependencies:** Tasks 6, 7

### Task 9: Root and rebase spans record provenance through the production visualizer
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing `OtelVisualizer` tests in `src/conductor/test/engine/otel/otel-visualizer.test.ts` with an in-memory exporter: completion with full provenance; a rebase step span receiving `baseSha`; halt after base `B` with no terminal `baseSha`; bases `B1` then `B2`; force-close via `stop()`; terminal event without `headSha`; rebase outcome with `baseSha: null`. Add `src/conductor/test/engine/otel/span-manager.test.ts` unit cases for the held base. Extend `src/conductor/test/engine/otel/metrics-listener.test.ts` to assert provenance fields create no new series or label.
2. Verify RED.
3. Implement: set `otel: true` for `rebase_noop`, `rebase_changed`, and `rebase_mergeable_skip` in `src/conductor/src/engine/event-sinks.ts` (other sink flags unchanged) so the events reach the visualizer; route `rebase_noop`, `rebase_changed`, and `rebase_mergeable_skip` in the `OtelVisualizer` event switch to new `SpanManager` handlers; `SpanManager` in `src/conductor/src/engine/otel/span-manager.ts` sets `vcs.base.sha` on the open `rebase` step span, holds the latest non-null base in memory, and in `closeRunSpan` stamps `vcs.head.sha`, `vcs.base.sha`, `conductor.pr.url`, and `conductor.pr.disposition` (force-close default `unrecorded`). Pattern: the existing `onLoopHalt` halt attributes (search `conductor.run.halt.reason`); omit absent values, never placeholders. No I/O in the span manager (adr-014 D4).
4. Verify GREEN and commit.

**Done when:**
- `OtelVisualizer` routes `rebase_noop`, `rebase_changed`, and `rebase_mergeable_skip` to `SpanManager`, and an `OtelVisualizer` test with an in-memory exporter asserts the exported `conductor.run` span carries `vcs.head.sha`, `vcs.base.sha`, `conductor.pr.url`, and `conductor.pr.disposition: 'opened'` from a `feature_complete` carrying them.
- `SpanManager` sets `vcs.base.sha` on the open rebase step span when a rebase outcome with a non-null `baseSha` arrives, and stamps the most recent held base on the root span at close when the terminal event has no `baseSha`, as asserted for a halt after base `B` and for a completion after bases `B1` then `B2` yielding `B2`.
- A run force-closed by `stop()` with no terminal event exports a `conductor.run` span with `conductor.pr.disposition: 'unrecorded'` and no `vcs.head.sha` or `conductor.pr.url` attribute.
- A terminal event with no `headSha` yields a root span with no `vcs.head.sha` attribute, and a rebase outcome with `baseSha: null` sets no `vcs.base.sha` and keeps the previously held base.
- Feeding the same provenance events to `MetricsListener` creates no new metric series and adds no data-point label, as asserted by comparing recorded label sets with and without the provenance fields.

**Files:** src/conductor/src/engine/otel/span-manager.ts; src/conductor/src/engine/otel/otel-visualizer.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/test/engine/otel/otel-visualizer.test.ts; src/conductor/test/engine/otel/span-manager.test.ts; src/conductor/test/engine/otel/metrics-listener.test.ts

**Dependencies:** Tasks 1, 8

### Task 10: Commit and PR toggles gate span provenance; persisted events stay complete
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing `OtelVisualizer` tests in `src/conductor/test/engine/otel/otel-visualizer.test.ts` with an in-memory exporter and an `EventPersister` on the same emitter: default provenance; `commit` false; `pr` false; every toggle false.
2. Verify RED.
3. Implement: pass the resolved provenance into `SpanManager` from `src/conductor/src/engine/otel/otel-visualizer.ts`; in `src/conductor/src/engine/otel/span-manager.ts` skip `vcs.*` attributes when `commit` is false and `conductor.pr.*` when `pr` is false. Toggles govern export only; never filter the events themselves.
4. Verify GREEN and commit.

**Done when:**
- With `provenance.commit` false, the exported root span and rebase step span carry no `vcs.head.sha` or `vcs.base.sha` while `conductor.pr.url`, `conductor.pr.disposition`, and the Resource `conductor.source.ref` are still exported, as asserted through `OtelVisualizer` with an in-memory exporter.
- With `provenance.pr` false, the exported root span of a run that completes with a PR carries neither `conductor.pr.url` nor `conductor.pr.disposition`.
- With the default resolved provenance, the exported trace carries every provenance attribute: `conductor.source.ref`, `vcs.head.sha`, `vcs.base.sha`, `conductor.pr.url`, and `conductor.pr.disposition`.
- With every toggle false, the events persisted to `events.jsonl` through `EventPersister` still carry `headSha`, `baseSha`, `prUrl`, and `prDisposition`.

**Files:** src/conductor/src/engine/otel/span-manager.ts; src/conductor/src/engine/otel/otel-visualizer.ts; src/conductor/test/engine/otel/otel-visualizer.test.ts

**Dependencies:** Tasks 6, 9

## Task Dependency Graph

```text
Task 1 ─┬─▶ Task 3 ─▶ Task 4 ─▶ Task 5
Task 2 ─┤
        └─▶ Task 7 ─┐
Task 6 ─────────────┴─▶ Task 8 ─▶ Task 9 (also needs Task 1) ─▶ Task 10 (also needs Task 6)
```

## Integration Points

- After Task 5: every terminal and rebase outcome event on the spine carries provenance, observable in `events.jsonl`.
- After Task 9: a full run exports a trace whose Resource and root span answer which commit, base, PR, and issue.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a verified run whose worktree HEAD is commit `H`, whose last rebase resolved base `B`, and whose state records a PR URL, when the run completes, then the emitted `feature_complete` event carries `headSha: H`, `baseSha: B`, the existing `prUrl`, and `prDisposition: 'opened'` | 3 | "for a run with HEAD `H`, base `B`, and a recorded PR URL yielding `prDisposition: 'opened'`" | diff-local |
| Story 1 happy: Given a verified run whose finish choice was `keep` and whose state records no PR URL, when the run completes, then `feature_complete` carries `prDisposition: 'none'` and no `prUrl` key | 2, 3 | "carries `prDisposition: 'none'` and has no `prUrl` key" | diff-local |
| Story 1 happy: Given a run that halts after a rebase resolved base `B`, when the halt is emitted, then the `loop_halt` event carries the worktree `headSha`, `baseSha: B`, and a `prDisposition` derived the same way as for completion | 4 | "as asserted for a halt after a rebase that recorded base `B`" | diff-local |
| Story 1 negative: Given a run that halts before any PR exists and with no `keep` finish choice, when the halt is emitted, then `loop_halt` carries `prDisposition: 'unrecorded'` and no `prUrl` key | 2, 4 | "emits `loop_halt` with `prDisposition: 'unrecorded'` and no `prUrl` key" | diff-local |
| Story 1 negative: Given a worktree where resolving HEAD fails, when the run completes, then `feature_complete` is still emitted with no `headSha` key, and the completion and its DONE marker are not blocked | 2, 3 | "is still emitted with no `headSha` key and the daemon DONE marker is still written" | diff-local |
| Story 1 negative: Given a run that never rebased, when it completes or halts, then the terminal event carries no `baseSha` key rather than a placeholder value | 3, 4 | "has no `baseSha` key and no placeholder value" | diff-local |
| Story 1 negative: Given a pre-existing `events.jsonl` line for `feature_complete` or `loop_halt` with none of the new fields, when the event persister and the metrics listener replay it, then both accept the record without throwing or dropping it | 1 | "asserts both accept every record without throwing and neither drops any record" | diff-local |
| Story 2 happy: Given a feature branch already current with a base whose tip is `B`, when the rebase step runs, then the emitted `rebase_noop` event carries `baseSha: B` | 5 | "for a current branch and a code-changing clean rebase against base tip `B`" | diff-local |
| Story 2 happy: Given a clean rebase onto a base whose tip is `B` that changes code paths, when the rebase step runs, then the emitted `rebase_changed` event carries `baseSha: B` alongside its existing changed-path fields | 5 | "while `rebase_changed` keeps its `changedPaths` and `allChangedPaths`" | diff-local |
| Story 2 happy: Given a branch that is behind but cleanly mergeable against base tip `B`, when the rebase step runs, then `rebase_mergeable_skip` still carries `baseSha: B` exactly as it does today | 5 | "emits `rebase_mergeable_skip` with the same `baseRef`, `baseSha`, and `baseKind` it emits today" | diff-local |
| Story 2 negative: Given a rebase whose base tip cannot be resolved, when the rebase outcome event is emitted, then it carries `baseSha: null` and the rebase step's outcome is otherwise unchanged | 5 | "carries `baseSha: null` and the outcome kind and every other field equal the resolvable case" | diff-local |
| Story 2 negative: Given a pre-existing `events.jsonl` line for `rebase_noop` or `rebase_changed` with no `baseSha`, when the event is replayed, then it is accepted without throwing | 1 | "asserts both accept every record without throwing and neither drops any record" | diff-local |
| Story 3 happy: Given a feature whose intake marker carries `Source-Ref: jstoup111/ai-conductor#2000`, when a run of that feature starts with OTel enabled, then the trace Resource carries `conductor.source.ref` equal to `jstoup111/ai-conductor#2000` | 7, 8 | "for a feature whose intake marker carries `Source-Ref: jstoup111/ai-conductor#2000`" | diff-local |
| Story 3 happy: Given that run exports a closed step span and then the process dies before the run span closes, when the backend receives the step span, then the step span's Resource still carries `conductor.source.ref` | 8 | "asserts the exported closed step span's Resource carries `conductor.source.ref` while no `conductor.run` span has been exported" | diff-local |
| Story 3 negative: Given a feature with no intake marker, when a run starts, then the trace Resource carries no `conductor.source.ref` attribute and the run starts normally | 7, 8 | "when the feature has no intake marker" | diff-local |
| Story 3 negative: Given a feature whose plan path cannot be resolved from its feature description, when a run starts, then the trace Resource carries no `conductor.source.ref` and no error is raised from start-context construction | 7, 8 | "when its plan path cannot be resolved" | diff-local |
| Story 3 negative: Given an intake marker whose `Source-Ref:` line is empty, when a run starts, then no `conductor.source.ref` attribute is set rather than an empty string | 7, 8 | "when the `Source-Ref:` line is empty" | diff-local |
| Story 3 negative: Given OTel enabled, when the metric Resource is built, then it carries no `conductor.source.ref` attribute | 8 | "the metrics signal never sets it" | diff-local |
| Story 4 happy: Given an OTel-enabled run whose events flow through the production visualizer, when `feature_complete` arrives with `headSha: H`, `baseSha: B`, a `prUrl`, and `prDisposition: 'opened'`, then the exported `conductor.run` span carries `vcs.head.sha: H`, `vcs.base.sha: B`, `conductor.pr.url`, and `conductor.pr.disposition: 'opened'` | 9 | "asserts the exported `conductor.run` span carries `vcs.head.sha`, `vcs.base.sha`, `conductor.pr.url`, and `conductor.pr.disposition: 'opened'`" | diff-local |
| Story 4 happy: Given a rebase outcome event with `baseSha: B` arrives while the rebase step span is open, when that step span is exported, then it carries `vcs.base.sha: B` | 9 | "sets `vcs.base.sha` on the open rebase step span when a rebase outcome with a non-null `baseSha` arrives" | diff-local |
| Story 4 happy: Given a rebase resolved base `B` earlier in the run and a later `loop_halt` arrives with no `baseSha`, when the root span closes, then it carries `vcs.base.sha: B` from the most recent rebase outcome | 9 | "as asserted for a halt after base `B`" | diff-local |
| Story 4 happy: Given two rebases in one run resolving `B1` then `B2`, when the run completes with no `baseSha` on the terminal event, then the root span carries `vcs.base.sha: B2` | 9 | "for a completion after bases `B1` then `B2` yielding `B2`" | diff-local |
| Story 4 negative: Given a run that is force-closed on stop without any terminal event, when the root span is exported, then it carries `conductor.pr.disposition: 'unrecorded'` and no `vcs.head.sha` or `conductor.pr.url` | 9 | "exports a `conductor.run` span with `conductor.pr.disposition: 'unrecorded'` and no `vcs.head.sha` or `conductor.pr.url` attribute" | diff-local |
| Story 4 negative: Given a terminal event with no `headSha`, when the root span closes, then the span carries no `vcs.head.sha` attribute rather than an empty or placeholder value | 9 | "A terminal event with no `headSha` yields a root span with no `vcs.head.sha` attribute" | diff-local |
| Story 4 negative: Given a rebase outcome event with `baseSha: null`, when it reaches the visualizer, then no `vcs.base.sha` attribute is set and any previously held base value is kept | 9 | "a rebase outcome with `baseSha: null` sets no `vcs.base.sha` and keeps the previously held base" | diff-local |
| Story 4 negative: Given the same provenance events, when the metrics listener processes them, then no metric instrument gains a new data-point label and no new metric series is created | 9 | "creates no new metric series and adds no data-point label" | diff-local |
| Story 5 happy: Given a config with no `otel.provenance` block, when OTel config resolves, then `commit`, `pr`, `issue`, and `feature` all resolve to enabled and every provenance attribute is exported | 6, 10 | "With the default resolved provenance, the exported trace carries every provenance attribute" | diff-local |
| Story 5 happy: Given `otel.provenance.commit: false`, when a run completes, then the exported root span and rebase step span carry no `vcs.head.sha` or `vcs.base.sha`, while PR and issue attributes are still exported | 10 | "With `provenance.commit` false, the exported root span and rebase step span carry no `vcs.head.sha` or `vcs.base.sha`" | diff-local |
| Story 5 happy: Given `otel.provenance.pr: false`, when a run completes with a PR, then the exported root span carries neither `conductor.pr.url` nor `conductor.pr.disposition` | 10 | "carries neither `conductor.pr.url` nor `conductor.pr.disposition`" | diff-local |
| Story 5 happy: Given `otel.provenance.issue: false` and an intake-backed feature, when a run starts, then the trace Resource carries no `conductor.source.ref` | 8 | "only when `sourceRef` is a non-empty string and `provenance.issue` is true" | diff-local |
| Story 5 happy: Given `otel.provenance.feature: false`, when a run starts, then the trace Resource carries no `conductor.feature` and its `service.instance.id` is the project name, a slash, and the run id | 8 | "its `service.instance.id` is the project name, a slash, and the run id" | diff-local |
| Story 5 negative: Given `otel.provenance.commit: "no"`, when config resolves, then resolution fails with a validation error naming `otel.provenance.commit` and the expected boolean type | 6 | "with an error naming `otel.provenance.commit` and the expected boolean type" | diff-local |
| Story 5 negative: Given `otel.provenance.branch: true`, when config resolves, then resolution fails with a validation error naming the unknown key `otel.provenance.branch` | 6 | "with an error naming the unknown key `otel.provenance.branch`" | diff-local |
| Story 5 negative: Given `otel.provenance: true` as a scalar instead of a mapping, when config resolves, then resolution fails with a validation error naming `otel.provenance` | 6 | "and `otel.provenance: true` resolves to `enabled: false` with an error naming `otel.provenance`" | diff-local |
| Story 5 negative: Given `otel.provenance.feature: false`, when the metric Resource is built and step metrics are recorded, then the metric Resource identity and every metric data-point `feature` label are unchanged from a run with the toggle on | 8 | "equal those recorded with the toggle on" | diff-local |
| Story 5 negative: Given every toggle false, when a run completes, then the events persisted to `events.jsonl` still carry `headSha`, `baseSha`, `prUrl`, and `prDisposition` | 10 | "still carry `headSha`, `baseSha`, `prUrl`, and `prDisposition`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-014-otel-observability-exporter#D1 | no-change | none | The exporter remains a listener on the existing ConductorEventEmitter; provenance arrives on events it already subscribes to. |
| adr-014-otel-observability-exporter#D2 | no-change | none | Packaging as the visualizer plugin is unchanged; no new plugin kind or registration is introduced. |
| adr-014-otel-observability-exporter#D3 | no-change | none | The generic visualizer wiring is reused as-is; only the start context gains an optional field. |
| adr-014-otel-observability-exporter#D4 | no-change | none | All SHA, PR, and source-ref resolution happens at emit sites or run start; SpanManager stays synchronous with no I/O. |
| adr-014-otel-observability-exporter#D5 | no-change | none | Failure isolation is unchanged; a provenance resolution failure omits the attribute and never throws into the bus. |
| adr-014-otel-observability-exporter#D6 | no-change | none | Transport selection under otel exporter, endpoint, and protocol is unchanged; provenance is a sibling key, not a transport. |
| adr-014-otel-observability-exporter#D7 | no-change | none | Metric ownership by the dispatcher-side MetricsListener is unchanged; no new metric is derived. |
| adr-014-otel-observability-exporter#D8 | no-change | none | Metric identity project/worker is unchanged; the feature toggle alters only the trace Resource service.instance.id. |
| adr-014-otel-observability-exporter#D9 | no-change | none | Daemon-level signals are untouched; no daemon instrument or daemon event is added. |
| adr-014-otel-observability-exporter#D10 | no-change | none | Every provenance value is unbounded and is placed on traces only; no data-point label is added. |
| adr-014-otel-observability-exporter#D11 | no-change | none | No new event type is added; provenance extends feature_complete, loop_halt, and rebase outcome events, which D18 governs. |
| adr-014-otel-observability-exporter#D12 | no-change | none | otel.attributes validation is unchanged; provenance keys are engine-owned under the reserved conductor. prefix. |
| adr-014-otel-observability-exporter#D13 | no-change | none | Static attributes still ride both Resources unchanged; provenance attributes are not static and ride traces only. |
| adr-014-otel-observability-exporter#D14 | no-change | none | The tier label and its terminal-event stamping are unchanged; provenance fields are added beside tier without altering it. |
| adr-014-otel-observability-exporter#D15 | no-change | none | The write-first spool is a transport concern; provenance adds span and Resource attributes only. |
| adr-014-otel-observability-exporter#D16 | no-change | none | The spool drainer and lease are unaffected by additional span attributes. |
| adr-014-otel-observability-exporter#D17 | no-change | none | Spool health events are unchanged; no spool event carries provenance. |
| adr-014-otel-observability-exporter#D18 | task | task-3, task-4, task-5, task-7 | `completeRun` emits `feature_complete` with `headSha` from `resolveHeadSha` |
| adr-014-otel-observability-exporter#D19 | task | task-8, task-9 | stamps the most recent held base on the root span at close |
| adr-014-otel-observability-exporter#D20 | task | task-6, task-8, task-10 | resolves an absent `otel.provenance` block to `provenance` with `commit`, `pr`, `issue`, and `feature` all true |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
