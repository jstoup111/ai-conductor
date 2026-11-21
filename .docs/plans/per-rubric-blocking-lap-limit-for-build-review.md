# Implementation Plan: per-rubric blocking-lap limit for build_review

**Date:** 2026-11-21
**Design:** none (technical track); decisions recorded in `.docs/decisions/adr-2026-10-19-build-review-finding-severity-advisory-threshold.md` (notes beside D1, D3, D4, D7; D8 and D9 added 2026-11-21) and `.docs/decisions/adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md` (note beside D5; D7 added 2026-11-21)
**Stories:** .docs/stories/per-rubric-blocking-lap-limit-for-build-review.md
**Conflict check:** skipped (Tier S)

## Summary

Give every build_review rubric a `max_blocking_laps` limit (default 2 for `implementationQuality`,
unlimited otherwise, `0` meaning unlimited). When a lap is joined, a rubric that already blocked its
limit of other laps is stamped onto the lap aggregate as lap-limited, and both effective reducers put
its otherwise-unresolved findings in the existing advisory bucket, so they never reach remediate.
The per-rubric blocking laps are persisted in `.pipeline/engine-state.json`, and the demotion is
reported on `build_review_outer_verdict`, the daemon log, and `build-review findings`. Six tasks.

## Technical Approach

- **Config (`src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`,
  `src/conductor/src/engine/resolved-config.ts`).** `BuildReviewRubricConfig` gains
  `max_blocking_laps?: number` (inherited by `BuildReviewCustomRubricConfig`). Both key lists in
  `config.ts` admit it, and both validators reject anything but a non-negative integer with
  `<path>.max_blocking_laps must be a non-negative integer`. `ResolvedBuildReviewRubricPolicy` gains
  `max_blocking_laps?: number`, present only for a positive limit. `resolveRubricPolicy` takes a
  `defaultMaxBlockingLaps` argument: `implementationQuality` passes 2, every other built-in and every
  custom rubric passes none. An explicit `0` resolves to no limit. Register the two keys in
  `src/conductor/test/engine/config-consumer-registry.ts` as resolved-config consumers.
- **Scope identity.** The lap-scope `declarationFingerprint` in `runRubricBuildReviewInner`
  (`src/conductor/src/engine/step-runners.ts`) hashes `JSON.stringify(entry.policy)`. Move that hash
  into an exported `buildReviewScopeDeclarationFingerprint(policy)` in
  `src/conductor/src/engine/build-review-review-frontier.ts` that omits `max_blocking_laps`, so the
  hash for every existing policy is byte-identical to today. The rubric cache fingerprint
  (`fingerprintBuildReviewRubricPolicy`) already lists its fields explicitly and is not changed.
- **Aggregate (`src/conductor/src/engine/build-review-aggregate.ts`).** `BuildReviewAggregate` and
  `BuildReviewAggregateInput` gain `blockingLapLimits?: readonly { rubric: string; blockingLaps:
  number; limit: number }[]`, joined like `declaredReplicationSuppressions`. `parseBuildReviewAggregate`
  admits the key only when present and rejects an entry whose rubric is empty, whose limit is not a
  positive integer, or whose `blockingLaps` is not an integer at least `limit`.
- **Reducers.** In `deriveEffectiveBuildReviewVerdict` (built-in) and the custom classification in
  `applyCurrentCustomEffectiveVerdict` (`src/conductor/src/engine/build-review-effective.ts`), after
  the `min_severity` advisory branch and before `unresolved`, a finding whose rubric is named in
  `aggregate.blockingLapLimits` is pushed to `advisory`. Infrastructure and scope-incomplete handling
  is untouched, so a lap-limited rubric's infrastructure failure still blocks.
- **State (`src/conductor/src/engine/build-review-blocking-laps.ts`, new).** Exports
  `buildReviewBlockingLapLimits(config)` (rubric id to positive limit, built-ins and custom catalog),
  `readBuildReviewBlockingLaps(projectRoot, child)` (rubric id to lap ids, through
  `createEngineStateStore(join(projectRoot, '.pipeline', 'engine-state.json')).read()`, scope key
  `feature` or `child-<k>`; absent, malformed, or non-string entries count as no laps),
  `lapLimitedBuildReviewRubrics({ limits, laps, lapId })` (entries whose count of lap ids other than
  `lapId` is at least the limit), `blockingBuildReviewRubrics(aggregate, effective)` (rubrics owning
  an unresolved finding, via `projectBuildReviewAggregateSources`), and
  `recordBuildReviewBlockingLaps(projectRoot, child, lapId, rubrics)` (one `store.update` that adds
  `lapId` once per rubric under `buildReviewBlockingLaps[scope][rubric]` and preserves every other
  key; returns the store's failure instead of throwing). This is durable state under event-spine
  exception C.
- **Runner wiring (`src/conductor/src/engine/step-runners.ts`).** In `runRubricBuildReviewInner` and
  `publishCustomOnlyBuildReview`: before `joinBuildReviewRubricOutcomes`, read the laps and pass
  `blockingLapLimits` (omitted when empty) into the join; after the effective verdict resolves and
  before the pass/fail fork, when `effective.ok`, call `recordBuildReviewBlockingLaps` with the
  rubrics `blockingBuildReviewRubrics` returns and, on failure, return
  `{ success: false, output: 'build_review blocking-lap persistence failed: <reason>' }`.
  `emitBuildReviewOuterVerdict` adds `blockingLapLimits` (each entry plus the `findingIds` of that
  rubric's sources that the effective verdict lists as advisory and that the severity projection did
  not claim) to the event, omitted when none. `src/conductor/src/types/events.ts` gains that optional
  field on `build_review_outer_verdict`.
- **Surfaces.** `src/conductor/src/daemon-cli.ts` renders one line per entry:
  `build_review lap-limited <rubric>: <n> finding(s) advisory (blocked <blockingLaps> of <limit> laps)`,
  using `finding` when n is 1. In `src/conductor/src/engine/build-review-cli.ts`,
  `AdvisoryFindingProjection` becomes a union with an `origin: 'lap-limit'` member carrying
  `blockingLaps` and `limit` (and `severity` when the finding has one); `advisoryFindings` emits it
  for an advisory source whose rubric is in `aggregate.blockingLapLimits` and which the threshold
  branch did not claim; the human renderer prints `origin: lap-limit`.
- **Repository config.** `.ai-conductor/config.yml` sets `build_review.rubrics.testQuality.max_blocking_laps: 3`
  with a comment naming the operator decision.
- **Test pattern.** Runner tests copy the `build-review-lap-scope-runner.test.ts` harness
  (`DefaultStepRunner`, mocked `coordinateBuildReviewRubrics` writing judged artifacts, calling
  `runRubricBuildReviewInner`), but inject a `buildReviewEffectiveResolver` that returns
  `deriveEffectiveBuildReviewVerdict(aggregate)` so the reducer under test is real, and an
  `EventPersister`-free `ConductorEventEmitter` listener for `build_review_outer_verdict`. Seed prior
  laps by writing `.pipeline/engine-state.json` directly.

## Prerequisites

- None.

## Tasks

### Task 1: Rubrics resolve a blocking-lap limit with defaults and validation
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-blocking-laps.test.ts` for every Done-when check below, using `resolveBuildReviewConfig`, `loadConfig` on temporary project roots, `loadConfig` on the repository root, and `buildReviewScopeDeclarationFingerprint`.
2. Verify RED.
3. Implement the config type, both validators and key lists, the resolved field with the `implementationQuality` default of 2, the registry entries, `buildReviewScopeDeclarationFingerprint` and its use in `runRubricBuildReviewInner`, and `testQuality.max_blocking_laps: 3` in `.ai-conductor/config.yml`.
4. Verify GREEN.
5. Commit: "feat(build-review): resolve per-rubric max_blocking_laps".

**Done when:**
- [test] `resolveBuildReviewConfig({})` yields `rubrics.implementationQuality.max_blocking_laps` 2 and no `max_blocking_laps` on `testQuality`, `security`, or a declared custom rubric; an explicit `testQuality` 3 yields 3; an explicit `implementationQuality` 0 yields none; a custom rubric declaring 1 yields 1.
- [test] `loadConfig` returns a validation error containing `build_review.rubrics.implementationQuality.max_blocking_laps must be a non-negative integer` for `-1`, errors naming `build_review.rubrics.security.max_blocking_laps` for `1.5` and `"2"`, and an error containing `build_review.custom_rubrics.portable.max_blocking_laps must be a non-negative integer` for `-2`.
- [test] `loadConfig` on the repository root, resolved, yields `testQuality` 3, `implementationQuality` 2, and no `security` limit.
- [test] `buildReviewScopeDeclarationFingerprint` returns the same value for an `implementationQuality` policy without `max_blocking_laps` and with `max_blocking_laps: 5`, and equals `sha256:` plus the SHA-256 of `JSON.stringify` of the policy without that key.

**Files likely touched:**
- `src/conductor/src/types/config.ts` — `max_blocking_laps` on `BuildReviewRubricConfig`
- `src/conductor/src/engine/config.ts` — key lists and both validators
- `src/conductor/src/engine/resolved-config.ts` — resolved field and per-rubric default
- `src/conductor/src/engine/build-review-review-frontier.ts` — `buildReviewScopeDeclarationFingerprint`
- `src/conductor/src/engine/step-runners.ts` — use the fingerprint helper
- `src/conductor/test/engine/config-consumer-registry.ts` — register both keys
- `src/conductor/test/engine/build-review-blocking-laps.test.ts` — config tests
- `.ai-conductor/config.yml` — `testQuality.max_blocking_laps: 3`

**Dependencies:** none

### Task 2: A lap-limited rubric's findings are advisory in both reducers
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-aggregate.test.ts` and `src/conductor/test/engine/build-review-effective.test.ts` for every Done-when check below, building aggregates with `joinBuildReviewRubricOutcomes` and a `blockingLapLimits` input.
2. Verify RED.
3. Implement the aggregate field, its join and parse validation, and the `lap-limited` branch in both reducers.
4. Verify GREEN, with every existing aggregate and effective test unchanged.
5. Commit: "feat(build-review): demote lap-limited rubric findings to advisory".

**Done when:**
- [test] `deriveEffectiveBuildReviewVerdict` over an aggregate whose `blockingLapLimits` names `implementationQuality` and whose only finding is a `critical` `implementationQuality` finding returns verdict PASS with that id in `advisoryFindingIds` and not in `unresolvedFindingIds`.
- [test] The same aggregate with an added `testQuality` finding returns FAIL with only the `testQuality` id unresolved; a lap-limited finding below `minConfidence` is in `suppressedFindingIds`; a lap-limited `implementationQuality` infrastructure failure returns FAIL with `implementationQuality` in `uncoveredInfrastructureFailureRubrics`.
- [test] `deriveComposedBuildReviewEffectiveVerdict` over a custom-rubric aggregate whose `blockingLapLimits` names the custom rubric returns that custom finding in `advisoryFindingIds` and verdict PASS.
- [test] `parseBuildReviewAggregate` returns `undefined` for a `blockingLapLimits` entry with limit 0 and for one with `blockingLaps` 1 and limit 2, and round-trips a valid entry unchanged.

**Files likely touched:**
- `src/conductor/src/engine/build-review-aggregate.ts` — aggregate field, join, parse, built-in reducer branch
- `src/conductor/src/engine/build-review-effective.ts` — custom reducer branch
- `src/conductor/test/engine/build-review-aggregate.test.ts` — reducer and parser tests
- `src/conductor/test/engine/build-review-effective.test.ts` — custom reducer test

**Dependencies:** none

### Task 3: Blocking laps are read, limited, and recorded through engine-state
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-blocking-laps.test.ts` for every Done-when check below against a temporary project root.
2. Verify RED.
3. Implement `src/conductor/src/engine/build-review-blocking-laps.ts` as described in Technical Approach.
4. Verify GREEN.
5. Commit: "feat(build-review): persist per-rubric blocking laps in engine-state".

**Done when:**
- [test] `recordBuildReviewBlockingLaps` for lap `lap-a` and rubric `implementationQuality` writes `buildReviewBlockingLaps.feature.implementationQuality` equal to `['lap-a']`, keeps a pre-existing unrelated `activePlanPath` key unchanged, and a second record of `lap-a` leaves exactly one `lap-a`.
- [test] A record with child 1 writes under `buildReviewBlockingLaps['child-1']`, and `readBuildReviewBlockingLaps` for child 2 returns no laps.
- [test] `readBuildReviewBlockingLaps` returns no laps for an absent file and for malformed JSON, and returns only `['lap-a']` when the rubric entry is `['lap-a', 7, null]`; for malformed JSON `recordBuildReviewBlockingLaps` returns a failure and leaves the file bytes unchanged.
- [test] `buildReviewBlockingLapLimits` over a config with `implementationQuality.max_blocking_laps: 0` has no `implementationQuality` entry, so `lapLimitedBuildReviewRubrics` with ten recorded laps returns nothing.
- [test] `lapLimitedBuildReviewRubrics` with limit 2 returns `{ rubric: 'implementationQuality', blockingLaps: 2, limit: 2 }` for laps `['lap-a','lap-b']` at `lap-c`, nothing for `['lap-a']` at `lap-c`, and nothing for `['lap-a','lap-c']` at `lap-c`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-blocking-laps.ts` — new state module
- `src/conductor/test/engine/build-review-blocking-laps.test.ts` — state tests

**Dependencies:** none

### Task 4: The build_review step stamps, records, and reports lap limits
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing runner tests in `src/conductor/test/engine/build-review-blocking-lap-runner.test.ts` for every Done-when check below, using the harness in Technical Approach with `implementationQuality` enabled at its default limit.
2. Verify RED.
3. Implement the runner wiring in `runRubricBuildReviewInner` and `publishCustomOnlyBuildReview`, the `blockingLapLimits` event field in `types/events.ts`, and its population in `emitBuildReviewOuterVerdict`.
4. Verify GREEN, with `build-review-lap-scope-runner.test.ts` and `build-review-step.test.ts` unchanged.
5. Commit: "feat(build-review): stamp and report blocking-lap limits at the lap join".

**Done when:**
- [test] With engine-state laps `['lap-a','lap-b']` for `implementationQuality`, a lap at a new HEAD that judges one `critical` `implementationQuality` finding resolves `{ success: true }`, the effective resolver receives an aggregate whose `blockingLapLimits` is `[{ rubric: 'implementationQuality', blockingLaps: 2, limit: 2 }]`, and `.pipeline/build-review.json` carries the same entry.
- [test] That lap emits `build_review_outer_verdict` with `effectiveVerdict` PASS and `blockingLapLimits` equal to `[{ rubric: 'implementationQuality', blockingLaps: 2, limit: 2, findingIds: [<the finding id>] }]`.
- [test] With engine-state laps `['lap-a']`, the same lap's effective verdict is FAIL with the finding unresolved, neither the aggregate nor the event carries `blockingLapLimits`, and engine-state afterwards lists the new lap id under `implementationQuality`.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — read, stamp, record, and event population in both lap paths
- `src/conductor/src/types/events.ts` — `blockingLapLimits` on `build_review_outer_verdict`
- `src/conductor/test/engine/build-review-blocking-lap-runner.test.ts` — runner tests

**Dependencies:** Task 1, Task 2, Task 3

### Task 5: Child scoping, repeated laps, and unreadable state keep their outcome
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing runner tests in `src/conductor/test/engine/build-review-blocking-lap-runner.test.ts` for every Done-when check below.
2. Verify RED by temporarily recording under the feature scope for a child, counting the current lap id, or swallowing the record failure; observe each fail, then restore.
3. Implement any defect these tests expose in the Task 3 module or the Task 4 wiring.
4. Verify GREEN.
5. Commit: "test(build-review): pin child scoping, repeat laps, and unreadable blocking-lap state".

**Done when:**
- [test] A child-1 lap that blocks on `implementationQuality` writes its lap id under `buildReviewBlockingLaps['child-1'].implementationQuality`, and a child-2 lap with no child-2 records judging one `implementationQuality` finding has effective verdict FAIL and no `blockingLapLimits`.
- [test] Running the same HEAD twice with limit 1 configured and no prior records leaves its lap id listed once and both runs report the finding unresolved.
- [test] With `.pipeline/engine-state.json` holding `{not json`, a lap judging one `implementationQuality` finding returns output containing `build_review blocking-lap persistence failed`, publishes an aggregate without `blockingLapLimits`, and leaves the file bytes unchanged.

**Files likely touched:**
- `src/conductor/test/engine/build-review-blocking-lap-runner.test.ts` — negative runner tests
- `src/conductor/src/engine/build-review-blocking-laps.ts` — only if a defect is exposed
- `src/conductor/src/engine/step-runners.ts` — only if a defect is exposed

**Dependencies:** Task 4

### Task 6: The daemon log and build-review findings show lap-limited findings
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-log-line-shape.test.ts` and `src/conductor/test/engine/build-review-cli.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the daemon-log line in `src/conductor/src/daemon-cli.ts` and the `lap-limit` projection and rendering in `src/conductor/src/engine/build-review-cli.ts`.
4. Verify GREEN.
5. Commit: "feat(build-review): surface lap-limited findings in the daemon log and findings CLI".

**Done when:**
- [test] Rendering a `build_review_outer_verdict` event with `blockingLapLimits: [{ rubric: 'implementationQuality', blockingLaps: 2, limit: 2, findingIds: ['f1'] }]` prints a line containing `build_review lap-limited implementationQuality: 1 finding advisory (blocked 2 of 2 laps)`.
- [test] `build-review findings` over a published aggregate whose `blockingLapLimits` names `implementationQuality` lists that finding as advisory with `origin: lap-limit` in human output and `"origin": "lap-limit"` with `blockingLaps` 2 and `limit` 2 in JSON output.

**Files likely touched:**
- `src/conductor/src/daemon-cli.ts` — lap-limited log line
- `src/conductor/src/engine/build-review-cli.ts` — `lap-limit` advisory projection and rendering
- `src/conductor/test/engine/daemon-log-line-shape.test.ts` — log line test
- `src/conductor/test/engine/build-review-cli.test.ts` — findings CLI test

**Dependencies:** Task 2

## Integration Points

- After Task 4: a third implementationQuality-blocked lap through `runRubricBuildReviewInner` publishes an effective PASS whose aggregate names the rubric lap-limited, so every later reader of `.pipeline/build-review.json` (gate predicate, adjudication coordinator) sees the finding as advisory.
- After Task 6: the operator sees the demotion in the daemon log and in `build-review findings`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a config with no `max_blocking_laps` anywhere, when `resolveBuildReviewConfig` resolves it, then `implementationQuality` has limit 2 and `testQuality`, `security`, and every custom rubric have no limit. | 1 | "yields `rubrics.implementationQuality.max_blocking_laps` 2" | diff-local |
| Story 1 happy: Given `build_review.rubrics.testQuality.max_blocking_laps: 3`, when the config is resolved, then `testQuality` has limit 3 and `implementationQuality` keeps limit 2. | 1 | "an explicit `testQuality` 3 yields 3" | diff-local |
| Story 1 happy: Given `build_review.rubrics.implementationQuality.max_blocking_laps: 0`, when the config is resolved, then `implementationQuality` has no limit. | 1 | "an explicit `implementationQuality` 0 yields none" | diff-local |
| Story 1 happy: Given a custom rubric declared with `max_blocking_laps: 1`, when the config is resolved, then that custom rubric has limit 1. | 1 | "a custom rubric declaring 1 yields 1" | diff-local |
| Story 1 happy: Given this repository's `.ai-conductor/config.yml`, when it is loaded and resolved, then `testQuality` has limit 3, `implementationQuality` has limit 2, and `security` has no limit. | 1 | "yields `testQuality` 3, `implementationQuality` 2, and no `security` limit" | diff-local |
| Story 1 negative: Given `build_review.rubrics.implementationQuality.max_blocking_laps: -1`, when the config is loaded, then loading fails with a validation error containing `build_review.rubrics.implementationQuality.max_blocking_laps must be a non-negative integer`. | 1 | "`build_review.rubrics.implementationQuality.max_blocking_laps must be a non-negative integer` for `-1`" | diff-local |
| Story 1 negative: Given `build_review.rubrics.security.max_blocking_laps: 1.5` or the string `"2"`, when the config is loaded, then loading fails with a validation error naming `build_review.rubrics.security.max_blocking_laps`. | 1 | "errors naming `build_review.rubrics.security.max_blocking_laps` for `1.5` and `"2"`" | diff-local |
| Story 1 negative: Given a custom rubric `portable` declared with `max_blocking_laps: -2`, when the config is loaded, then loading fails with a validation error containing `build_review.custom_rubrics.portable.max_blocking_laps must be a non-negative integer`. | 1 | "`build_review.custom_rubrics.portable.max_blocking_laps must be a non-negative integer` for `-2`" | diff-local |
| Story 1 negative: Given `implementationQuality.max_blocking_laps` changes from unset to 5, when the next build_review lap derives its review scope, then the lap-scope policy identity is unchanged and the lap reviews a delta rather than restarting at a full scope. | 1 | "returns the same value for an `implementationQuality` policy without `max_blocking_laps` and with `max_blocking_laps: 5`" | diff-local |
| Story 2 happy: Given `implementationQuality` with limit 2 that already blocked laps A and B, when lap C judges one `critical` `implementationQuality` finding and no other rubric has an unresolved finding, then lap C's effective verdict is PASS and that finding id is in the effective verdict's advisory findings. | 2, 4 | "resolves `{ success: true }`" | diff-local |
| Story 2 happy: Given lap C was lap-limited for `implementationQuality`, when lap C's aggregate is read back from `.pipeline/build-review.json`, then it carries `blockingLapLimits` with one entry naming `implementationQuality`, blocking laps 2, and limit 2. | 4 | "`.pipeline/build-review.json` carries the same entry" | diff-local |
| Story 2 happy: Given lap C was lap-limited for `implementationQuality`, when its `build_review_outer_verdict` event is emitted, then the event carries `blockingLapLimits` with one entry naming `implementationQuality`, blocking laps 2, limit 2, and the demoted finding id. | 4 | "emits `build_review_outer_verdict` with `effectiveVerdict` PASS and `blockingLapLimits`" | diff-local |
| Story 2 happy: Given that `build_review_outer_verdict` event, when the daemon log renders it, then it prints one line containing `build_review lap-limited implementationQuality`, `1 finding advisory`, and `blocked 2 of 2 laps`. | 6 | "`build_review lap-limited implementationQuality: 1 finding advisory (blocked 2 of 2 laps)`" | diff-local |
| Story 2 happy: Given an aggregate stamped with `blockingLapLimits` for `implementationQuality`, when any reader derives the effective verdict from that aggregate alone, then the `implementationQuality` findings are advisory and absent from the unresolved findings, so the adjudication coordinator treats them as non-actionable. | 2 | "returns verdict PASS with that id in `advisoryFindingIds` and not in `unresolvedFindingIds`" | diff-local |
| Story 2 happy: Given a lap-limited `implementationQuality` finding, when `build-review findings` reports the lap, then the finding is listed as advisory with origin `lap-limit`. | 6 | "lists that finding as advisory with `origin: lap-limit`" | diff-local |
| Story 2 negative: Given `implementationQuality` with limit 2 that blocked only lap A, when lap C judges one `implementationQuality` finding, then lap C's effective verdict is FAIL with that finding unresolved and the aggregate carries no `blockingLapLimits`. | 4 | "the same lap's effective verdict is FAIL with the finding unresolved, neither the aggregate nor the event carries `blockingLapLimits`" | diff-local |
| Story 2 negative: Given `implementationQuality` is lap-limited on lap C, when lap C also judges one `testQuality` finding and `testQuality` has no limit, then lap C's effective verdict is FAIL with only the `testQuality` finding unresolved. | 2 | "returns FAIL with only the `testQuality` id unresolved" | diff-local |
| Story 2 negative: Given `implementationQuality` is lap-limited on lap C, when one of its findings has confidence below the rubric's `min_confidence`, then that finding is suppressed rather than advisory. | 2 | "a lap-limited finding below `minConfidence` is in `suppressedFindingIds`" | diff-local |
| Story 2 negative: Given `implementationQuality` is lap-limited on lap C, when its result for lap C is an infrastructure failure, then lap C's effective verdict is FAIL with `implementationQuality` an uncovered infrastructure failure. | 2 | "FAIL with `implementationQuality` in `uncoveredInfrastructureFailureRubrics`" | diff-local |
| Story 2 negative: Given `implementationQuality.max_blocking_laps: 0` and ten recorded blocking laps, when another lap judges an `implementationQuality` finding, then that finding is unresolved and the effective verdict is FAIL. | 3 | "so `lapLimitedBuildReviewRubrics` with ten recorded laps returns nothing" | diff-local |
| Story 2 negative: Given an aggregate whose `blockingLapLimits` entry has a limit of 0 or a blocking-lap count below its limit, when `parseBuildReviewAggregate` reads it, then the aggregate is rejected as malformed. | 2 | "returns `undefined` for a `blockingLapLimits` entry with limit 0 and for one with `blockingLaps` 1 and limit 2" | diff-local |
| Story 3 happy: Given a lap whose effective verdict has an unresolved `implementationQuality` finding and no unresolved `testQuality` finding, when the build_review step finishes that lap, then `.pipeline/engine-state.json` lists that lap id under `buildReviewBlockingLaps.feature.implementationQuality` and lists nothing for `testQuality`. | 4 | "engine-state afterwards lists the new lap id under `implementationQuality`" | diff-local |
| Story 3 happy: Given the same lap id is reviewed again at the same HEAD, when the step finishes it again, then that lap id appears once under `implementationQuality`, and the lap is not lap-limited by its own earlier record. | 5 | "leaves its lap id listed once and both runs report the finding unresolved" | diff-local |
| Story 3 happy: Given a stacked feature reviewing child 1, when a child-1 lap blocks on `implementationQuality`, then the lap id is listed under `buildReviewBlockingLaps.child-1.implementationQuality`, and a child-2 lap with no child-2 records is not lap-limited. | 5 | "writes its lap id under `buildReviewBlockingLaps['child-1'].implementationQuality`" | diff-local |
| Story 3 happy: Given `.pipeline/engine-state.json` already holds unrelated keys, when a blocking lap is recorded, then those keys are preserved unchanged. | 3 | "keeps a pre-existing unrelated `activePlanPath` key unchanged" | diff-local |
| Story 3 negative: Given `.pipeline/engine-state.json` is absent, when a lap with an `implementationQuality` finding is joined, then the rubric counts zero blocking laps and the finding is unresolved. | 3 | "returns no laps for an absent file" | diff-local |
| Story 3 negative: Given `.pipeline/engine-state.json` holds malformed JSON, when a lap with an `implementationQuality` finding is joined, then the rubric counts zero blocking laps, the finding is unresolved, and the step reports `build_review blocking-lap persistence failed` rather than overwriting the file. | 5 | "returns output containing `build_review blocking-lap persistence failed`" | diff-local |
| Story 3 negative: Given `buildReviewBlockingLaps` holds a non-array or non-string entry for a rubric, when the count is read, then only the valid string lap ids are counted. | 3 | "returns only `['lap-a']` when the rubric entry is `['lap-a', 7, null]`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D1 | task | task-2 | a `critical` `implementationQuality` finding returns verdict PASS with that id in `advisoryFindingIds` |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D2 | no-change | none | No contract version or finding identity changes; `blockingLapLimits` is an aggregate field outside identity. |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D3 | task | task-1 | `resolveBuildReviewConfig({})` yields `rubrics.implementationQuality.max_blocking_laps` 2 |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D4 | task | task-2 | returns FAIL with only the `testQuality` id unresolved; a lap-limited finding below `minConfidence` is in `suppressedFindingIds` |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D5 | no-change | none | Severity advisory entries, the case-store suppression union, and the PR-body region are unchanged; D9 keeps lap-limited findings out of them. |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D6 | no-change | none | The remediate `advisory` disposition is untouched; lap-limited findings never reach remediate. |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D7 | existing | none | `finalizedBuildReviewSourceIds` is unchanged; a lap-limited finding never creates an advisory case. |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D8 | task | task-1, task-2, task-4 | the effective resolver receives an aggregate whose `blockingLapLimits` is `[{ rubric: 'implementationQuality', blockingLaps: 2, limit: 2 }]` |
| adr-2026-10-19-build-review-finding-severity-advisory-threshold#D9 | task | task-3, task-4, task-6 | writes `buildReviewBlockingLaps.feature.implementationQuality` equal to `['lap-a']` |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | task | task-2 | a lap-limited `implementationQuality` infrastructure failure returns FAIL with `implementationQuality` in `uncoveredInfrastructureFailureRubrics` |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | One remediate dispatch still owns fan-in; it simply receives fewer live sources. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | no-change | none | Content and infrastructure composition is unchanged. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | Confidence suppression keeps precedence over lap-limit demotion, as Task 2 asserts. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | existing | none | The coordinator already treats `advisoryFindingIds` as non-actionable (`nonActionable` in `build-review-adjudication-coordinator.ts`); recurrence rules are unchanged for live sources. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D6 | no-change | none | Deferral filing is untouched. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D7 | task | task-2, task-4 | That lap emits `build_review_outer_verdict` with `effectiveVerdict` PASS |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
