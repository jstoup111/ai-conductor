# Implementation Plan: Malformed Covers token routes back to BUILD instead of exhausting the build_review fault allowance

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/unresolved-covers-marker-on-a-changed-test-exhaust.md`)
**Stories:** .docs/stories/unresolved-covers-marker-on-a-changed-test-exhaust.md
**Conflict check:** Not required (Tier S)

## Summary

Make `build_review` detect, before any rubric dispatch, a changed test whose only Covers evidence is
a malformed token this feature introduced (for example `// Covers: Task: 32`), and have the conductor
route that result to BUILD as a bounded `build_review` kickback naming file, line, and token, without
charging the mechanical-fault allowance. Five tasks: a pure detector, its exposure on the frozen
inputs, the step-runner gate, the conductor route, and the reference/runbook prose.

## Technical Approach

- **Why the defect loops today.** `parseCoversMarkers` (`src/conductor/src/engine/covers-marker.ts:20-42`)
  returns `{ kind: 'unresolved', id: 'Task: 32' }` for any token outside the `task:<id>` /
  `S<story>.<n>` / `FR-<n>` grammars. The binding is `unresolved-reference`
  (`build-review-test-bindings.ts:201-210`), the declaration is unbound, and the test scope forwards it
  to the reviewer as an uncertain candidate (`build-review-test-scope.ts:605-617`,
  `build-review-inputs.ts:576-582`). The reviewer resolves it `indeterminate`;
  `deriveBuildReviewScopeIncompleteFault` (`build-review-domain.ts:809-816`) turns that into
  `scope-incomplete`, and the conductor's D3.2 lane charges `bumpMechanicalFaultsInLedgerResult` and
  re-lands `build_review` on the same tree (`conductor.ts:12226-12268`) until the allowance halts.
- **Detector (machinery, not judgement).** Whether a token matches a reference grammar is mechanical,
  so the engine decides it. New exported pure function `findMalformedCoversMarkers(input:
  BuildReviewTestScopeInput): readonly MalformedCoversMarker[]` in
  `src/conductor/src/engine/build-review-test-scope.ts`, where `MalformedCoversMarker = { path: string;
  line: number; token: string }` (`line` is 1-based, from `marker.span.start` in the HEAD text). It
  reuses the same changed-declaration set, HEAD bindings, and introduced-association rule that
  `analyzeBuildReviewTestScope` already computes (`build-review-test-scope.ts:569-620`;
  `isIntroducedAssociation`). A changed declaration reports a marker only when **all** hold:
  (1) its HEAD bindings contain no `bound` binding (no reference resolves in the active feature);
  (2) the marker's `reference.kind === 'unresolved'`; (3) the trimmed token is non-empty; (4) the
  association is introduced (absent at the merge-base). Results are de-duplicated by
  `(path, line, token)` and sorted by path, then line, then token. Condition (1) keeps tests with a
  resolving reference alongside a near-miss trailing token (for example the existing
  `describe('… (Covers: FR-8, FR-10, FR-12)')` titles) out of scope. Condition (4) leaves legacy
  markers already present at the merge-base on today's path. A well-formed `task:<id>` naming an
  absent task has `kind: 'task'`, so it is never reported and keeps its existing reviewer →
  `scope-incomplete` path (story negative path).
- **Exposure outside the frozen snapshot.** The typed test-scope assembly in
  `src/conductor/src/engine/build-review-inputs.ts` (the function returning `{ scope, scopeEvidence,
  testQuality, changedTestTitles }`, ~`:614-740`) calls the detector per scoped test file and returns a
  sibling `malformedCoversMarkers` array. `assembleBuildReviewInputs` puts it on
  `BuildReviewFrozenInputs.malformedCoversMarkers` (top-level field, `build-review-inputs.ts:108-113`).
  It is **not** added to `BuildReviewTestScope`, `BuildReviewTestQualityScope`, the
  `sourceSnapshot` (`:880-906`), or the rubric projections (`build-review-projections.ts:473-490`), so
  snapshot digests, cache keys, and the reviewer contract are unchanged.
- **Step-runner gate.** In `runBuildReview` (`src/conductor/src/engine/step-runners.ts:5419-5617`),
  immediately before the coordinator / `runRubricBuildReview` dispatch and after the
  `buildReviewConfig.enabled` check, when `buildReviewConfig.rubrics.testQuality.enabled` and
  `inputs.malformedCoversMarkers.length > 0`, return `withBaseFreshness({ success: false, output,
  buildReviewMalformedCovers })` without dispatching anything. `output` is one header line
  `build_review: changed test Covers marker matches no reference grammar` followed by one line per
  marker, `<path>:<line> token \`<token>\`` (every marker, uncapped, so kickback evidence and HALT text name each one), and a final line
  `Accepted forms: task:<id>, S<story>.<n>, FR-<n>.` `StepRunResult` in
  `src/conductor/src/engine/step-runner-types.ts` gains the optional
  `buildReviewMalformedCovers?: readonly MalformedCoversMarker[]` field. This follows the existing
  blocking-precondition precedent in the same method (copy-equivalence, `:5558-5590`).
- **Conductor route (reuse the bounded kickback, not the mechanical lane).** In
  `src/conductor/src/engine/conductor.ts`:
  1. In the per-attempt handling, beside the existing `validatorFault` early exit (`:9919-9932`),
     when `step.name === 'build_review'` and `result.buildReviewMalformedCovers` is non-empty, record
     it in a new run-local `buildReviewMalformedCovers` variable (declared next to
     `unretryableInputFailure`, `:9230`) and `break` out of the attempt loop before any retry
     accounting, so no `step_retry` event is emitted and the runner is not re-invoked. A retry cannot
     change the tree.
  2. In the auto-mode failure block, immediately before the `// build_review kickback` block
     (`:11973`) and under the same predicate (`this.daemon || this.mode === 'auto' ||
     this.hasEnabledCustomBuildReviewPolicy()`), route exactly like the `test_suite` route
     (`:11911-11971`): `consumeKickbackBudget('build_review', evidence)`. When it is not exhausted, emit
     `{ type: 'kickback', from: 'build_review', to: 'build', evidence, count }` and set
     `pendingRetryHints` for `build` to `build_review found malformed Covers markers:\n<evidence>\nFix
     each token to an accepted form and commit before build_review re-runs.`. Then call
     `stopIfPrMerged` and `captureKickbackToBuildContext('build_review')`, `navigateStateBack(state,
     'build', steps)`, and `commitStateChanges` with `filterRestageChanges(state, { build_review:
     'stale', manual_test: 'stale' })` (the restage the adjudicated repair route uses, `:12224-12229`),
     then `i = navigationIndex - 1; continue`. When it is exhausted, write a `needs-human` HALT whose
     reason is `build_review malformed Covers markers unresolved after <count> build kickback(s) (cap
     ${MAX_KICKBACKS_PER_GATE}): <evidence>`, persist, `emitLoopHalt`, and return. It never calls
     `bumpMechanicalFaultsInLedgerResult`.
  `evidence` is the step's `output`. Telemetry rides the existing `kickback` event on the event spine.
  No new event type or channel is added.
- **Interactive (non-auto) mode** keeps its existing failure handling. The failed step's output names
  the tokens, and only the attempt-loop `break` is shared.
- **Unchanged:** the Covers grammar, `parseCoversMarkers`, the reviewer contract, the infrastructure
  and `scope-incomplete` mechanical lane, `MAX_KICKBACKS_PER_GATE`, and the reduced-coverage CLI.

## Prerequisites

- None.

## Tasks

### Task 1: Pure detector for introduced malformed Covers tokens on unbound changed tests
**Story:** Story 1 (happy path 1 — detection; negative paths 1–4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-test-scope.test.ts` for `findMalformedCoversMarkers`, building `BuildReviewTestScopeInput` base/HEAD fixtures the way the existing tests in that file do, with a plan that has Tasks 1–3:
   (a) HEAD adds `// Covers: Task: 32` as the leading comment of a new `it(...)` on line 5. The result is exactly `[{ path, line: 5, token: 'Task: 32' }]`.
   (b) HEAD adds `// Covers: task:99` instead. The result is `[]`.
   (c) HEAD adds `// Covers: task:1, Task: 32`, where `task:1` resolves. The result is `[]`.
   (d) The same `// Covers: Task: 32` marker and declaration exist at base, and HEAD changes only the test body. The result is `[]`.
   (e) HEAD adds `// Covers: ,` above a new test. The result is `[]`.
   (f) Two introduced malformed markers in one file on lines 9 and 4. The result is sorted by line, with one entry per `(path, line, token)`.
2. Verify RED.
3. Implement `findMalformedCoversMarkers` and export the `MalformedCoversMarker` type from `build-review-test-scope.ts`. Reuse the module's existing binding comparison, `targetBindings`, and `isIntroducedAssociation` helpers. Do not duplicate grammar regexes; classify only by `reference.kind === 'unresolved'`. Compute `line` as 1 + the count of `\n` in the HEAD text before `marker.span.start`. Do not add a field or note kind to `BuildReviewTestScope`.
4. Verify GREEN; commit "feat(build-review): detect introduced malformed Covers tokens on unbound changed tests".

**Done when:**
- [test] `build-review-test-scope.test.ts` asserts `findMalformedCoversMarkers` returns exactly `[{ path, line: 5, token: 'Task: 32' }]` for an introduced `// Covers: Task: 32` on an unbound changed test.
- [test] The same file asserts the detector returns `[]` for the well-formed absent `task:99`, the resolving-sibling `task:1, Task: 32`, the merge-base-present marker, and the empty-token `// Covers: ,` fixtures.
- [test] The same file asserts two introduced malformed markers on lines 9 and 4 come back sorted by line with no duplicates.
- `BuildReviewTestScope` and `BuildReviewTestScopeNote` in `build-review-test-scope.ts` are unchanged by the diff, and existing `build-review-test-scope.test.ts` cases pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/build-review-test-scope.ts` — `findMalformedCoversMarkers`, `MalformedCoversMarker`
- `src/conductor/test/engine/build-review-test-scope.test.ts` — detector cases

**Dependencies:** none

### Task 2: Input assembly exposes malformed markers outside the frozen snapshot
**Story:** Story 1 (happy paths 1–2 — path, line, token reach the gate; Done When 3)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-inputs.test.ts`. Use the file's existing git-fixture pattern. Commit two changed test files, each with an introduced `// Covers: Task: 32` on a new unbound test, and assert `assembleBuildReviewInputs(...).malformedCoversMarkers` lists both repo-relative paths with their lines and tokens. In a second case, the same tree with the token corrected to a resolving `task:1` yields `malformedCoversMarkers: []`. Assert `inputs.sourceSnapshot` has no `malformedCoversMarkers` key and `inputs.sourceSnapshot.testQuality` keys equal `['counterfactualFileSelectors', 'inScopeTests', 'unresolvedMarkers']` (sorted).
2. Verify RED.
3. In `build-review-inputs.ts`, call `findMalformedCoversMarkers` per scoped file in the typed test-scope assembly, using the same `BuildReviewTestScopeInput` passed to the analyzer, and return the flattened, path-sorted list as a sibling of `scope`/`testQuality`. Add `readonly malformedCoversMarkers: readonly MalformedCoversMarker[]` to `BuildReviewFrozenInputs` and populate it in `assembleBuildReviewInputs`. When the analyzer throws for a file (`unavailableBuildReviewTestScope` path), contribute no entries for that file.
4. Verify GREEN; commit "feat(build-review): expose malformed Covers markers on frozen inputs".

**Done when:**
- [test] `build-review-inputs.test.ts` asserts `assembleBuildReviewInputs` returns `malformedCoversMarkers` naming both changed test files' repo-relative paths, 1-based lines, and the token `Task: 32`.
- [test] The same file asserts the corrected-token tree yields `malformedCoversMarkers: []`.
- [test] The same file asserts `sourceSnapshot` carries no `malformedCoversMarkers` key and `sourceSnapshot.testQuality` keys are exactly `counterfactualFileSelectors`, `inScopeTests`, `unresolvedMarkers`.
- `deriveBuildReviewRubricProjections` in `build-review-projections.ts` is unchanged by the diff.

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — assembly and `BuildReviewFrozenInputs.malformedCoversMarkers`
- `src/conductor/test/engine/build-review-inputs.test.ts` — exposure and snapshot-shape cases

**Dependencies:** Task 1

### Task 3: build_review step short-circuits on malformed markers before any rubric dispatch
**Story:** Story 1 (happy paths 1–2; negative paths 1, 5)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-step.test.ts`. Use the file's existing `DefaultStepRunner` + mocked `coordinateBuildReviewRubrics` harness, with `testQuality` enabled and a git fixture holding one changed test with an introduced `// Covers: Task: 32`:
   (a) `run('build_review')` returns `success: false` and `buildReviewMalformedCovers` equal to `[{ path, line, token: 'Task: 32' }]`. `output` starts with `build_review: changed test Covers marker matches no reference grammar`, contains `<path>:<line> token \`Task: 32\``, and ends with `Accepted forms: task:<id>, S<story>.<n>, FR-<n>.`. The coordinator mock has zero calls, and no `.pipeline/build-review.json` publication occurs.
   (b) The same tree with two such files has `output` naming both.
   (c) A tree whose only introduced marker is `// Covers: task:99` (absent task) has no `buildReviewMalformedCovers`, and the coordinator mock is called once.
   (d) With `testQuality` disabled, the malformed tree's result has no `buildReviewMalformedCovers`, the coordinator mock is called once, and the step returns the coordinator's result unchanged.
   (e) A tree whose introduced marker is `// Covers: task:1, Task: 32`, where `task:1` resolves, has no `buildReviewMalformedCovers` and the coordinator mock is called once.
2. Verify RED.
3. Add `buildReviewMalformedCovers?: readonly MalformedCoversMarker[]` to `StepRunResult` in `step-runner-types.ts`. In `runBuildReview`, after the `buildReviewConfig.enabled` check and before the coordinator / `runRubricBuildReview` dispatch, return the failed result described in Technical Approach when `buildReviewConfig.rubrics.testQuality.enabled && inputs.malformedCoversMarkers.length > 0`, wrapped in `withBaseFreshness`. List every marker; do not truncate.
4. Verify GREEN; commit "feat(build-review): fail fast on malformed Covers markers before review dispatch".

**Done when:**
- [test] `build-review-step.test.ts` asserts that for an introduced `// Covers: Task: 32`, `run('build_review')` returns `success: false` with `buildReviewMalformedCovers` naming the path, line, and token, and the coordinator mock is never called.
- [test] The same file asserts the output names every malformed file as `<path>:<line> token \`<token>\`` and ends with the accepted-forms line, for the one-file and two-file fixtures.
- [test] The same file asserts the `task:99` absent-task tree carries no `buildReviewMalformedCovers` and dispatches the coordinator once with frozen inputs whose `sourceSnapshot.testQuality.unresolvedMarkers` contains reference `task:99`, and the resolving-sibling `task:1, Task: 32` tree carries no `buildReviewMalformedCovers` and dispatches the coordinator once.
- [test] The same file asserts that with `testQuality` disabled the malformed tree carries no `buildReviewMalformedCovers`, the coordinator mock is called once, and the step returns the coordinator's result unchanged.

**Files likely touched:**
- `src/conductor/src/engine/step-runner-types.ts` — `buildReviewMalformedCovers` field
- `src/conductor/src/engine/step-runners.ts` — pre-dispatch gate in `runBuildReview`
- `src/conductor/test/engine/build-review-step.test.ts` — gate cases

**Dependencies:** Task 2

### Task 4: Conductor routes malformed markers to BUILD under the kickback cap, never the mechanical lane
**Story:** Story 2 (happy paths 1–3; negative paths 1–3)
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/conductor-build-review-malformed-covers.test.ts`. Reuse the conductor harness of `conductor-build-review-adjudication.test.ts`: auto mode, a step runner whose `build_review` returns `{ success: false, output, buildReviewMalformedCovers: [{ path: 'src/a.test.ts', line: 5, token: 'Task: 32' }] }` on the first lap and a PASS on the next, a temp project root, and captured events.
   (a) Through `Conductor.run`, exactly one `kickback` event from `build_review` to `build` is emitted, with evidence containing `src/a.test.ts:5 token \`Task: 32\``. The `build` dispatch's retry hint contains that evidence. `build_review` and `manual_test` are restaged stale. The `build_review` runner is invoked once in the first lap, with no `step_retry` event for `build_review`. `.pipeline/kickback-ledger.json` `gates.build_review.count` rose by exactly 1, and `mechanicalFaults` and `lastMechanicalFault` are absent or unchanged.
   (b) Seed the ledger's `gates.build_review.count` at `MAX_KICKBACKS_PER_GATE`. The run writes a `needs-human` HALT whose text contains `build_review malformed Covers markers unresolved after`, `src/a.test.ts:5`, `Task: 32`, and `cap 2`. No `kickback` event is emitted, and `mechanicalFaults` is unchanged.
2. Verify RED.
3. Implement the two conductor edits described in Technical Approach: the attempt-loop `break` beside `validatorFault`, and the route before the `// build_review kickback` block. Reuse `consumeKickbackBudget`, `emitTracked`, `pendingRetryHints`, `stopIfPrMerged`, `captureKickbackToBuildContext`, `navigateStateBack`, `commitStateChanges`/`filterRestageChanges`, `writeHaltMarker`, and `emitLoopHalt`. Do not call `bumpMechanicalFaultsInLedgerResult`, and do not read `.pipeline/build-review.json` on this route.
4. Run `conductor-build-review-adjudication.test.ts` unchanged and confirm the existing `keeps an uncovered infrastructure branch in the mechanical lane without a semantic kickback` and `takes the bounded mechanical lane for an uncovered indeterminate-only scope fault` cases still pass.
5. Verify GREEN; commit "feat(conductor): route malformed Covers markers to BUILD without spending the mechanical allowance".

**Done when:**
- [test] `conductor-build-review-malformed-covers.test.ts` asserts through `Conductor.run` one `kickback` event `build_review`→`build` whose evidence names `src/a.test.ts:5` and `Task: 32`, and that the following `build` dispatch's retry hint contains that evidence and the line `Accepted forms: task:<id>, S<story>.<n>, FR-<n>.`
- [test] The same test asserts `build_review` and `manual_test` are restaged stale, the `build_review` runner is invoked once in that lap with no `build_review` `step_retry` event, and the ledger `gates.build_review.count` rises by exactly 1 while `mechanicalFaults` and `lastMechanicalFault` are unchanged.
- [test] The same file asserts that with `gates.build_review.count` at `MAX_KICKBACKS_PER_GATE` the run writes a `needs-human` HALT naming `src/a.test.ts:5`, `Task: 32`, and `cap 2`, emits no `kickback` event, and leaves `mechanicalFaults` unchanged.
- [test] `conductor-build-review-adjudication.test.ts` case `keeps an uncovered infrastructure branch in the mechanical lane without a semantic kickback` passes with no assertion edits in the diff, still asserting an uncovered `provider-error` on `testQuality` is charged to the mechanical lane one fault per lap until `mechanicalFaults` is 3 with `lastMechanicalFault.reason` `provider-error` and no kickback.
- [test] `conductor-build-review-adjudication.test.ts` case `takes the bounded mechanical lane for an uncovered indeterminate-only scope fault` passes with no assertion edits in the diff, still asserting the indeterminate candidate is charged as `scope-incomplete` (`lastMechanicalFault.reason` `scope-incomplete`, `mechanicalFaults` 3), emits no kickback, and halts naming `scope-incomplete testQuality`, so it is not accepted.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — attempt-loop break and BUILD kickback route
- `src/conductor/test/engine/conductor-build-review-malformed-covers.test.ts` — new route tests

**Dependencies:** Task 3

### Task 5: Document the malformed-marker route in the step reference and runbook
**Story:** Story 1 (happy path 1 — operator-visible behavior); Story 2 (negative path 1 — halt recovery)
**Type:** infrastructure

**Steps:**
1. In `docs/reference/steps.md`, in the `build_review` prose after the sentence ending `Only a \`Covers\` marker in a real comment binds; …`, add a paragraph stating the following. When `testQuality` is enabled, a changed test declaration with no resolving Covers reference whose introduced marker carries a token matching none of `task:<id>`, `S<story>.<n>`, `FR-<n>` is not reviewed. `build_review` fails before dispatch, and the conductor routes it to BUILD as a `build_review` kickback naming file, line, and token. The route never charges the mechanical-fault allowance and halts `needs-human` once the kickback cap is spent.
2. In `docs/runbooks/stalled-or-stuck-feature.md`, add a `### build_review reports a malformed Covers marker` section next to `### build_review has a scope-incomplete candidate`. It gives the HALT text prefix `build_review malformed Covers markers unresolved after`, the fix (correct each named token in the feature worktree, commit, clear `.pipeline/HALT` and `.pipeline/HALT.class`), and a note that `record-reduced-coverage` does not apply to this halt.
3. Check that both new links/anchors resolve; commit "docs: describe the malformed Covers marker route".

**Done when:**
- `docs/reference/steps.md` contains a paragraph in the `build_review` prose naming the three accepted forms, the pre-dispatch failure, the `build_review` kickback to BUILD, and that the mechanical-fault allowance is not charged.
- `docs/runbooks/stalled-or-stuck-feature.md` contains a `### build_review reports a malformed Covers marker` section quoting `build_review malformed Covers markers unresolved after` and the token-fix recovery steps.
- `test/test_harness_integrity.sh` passes, including its documentation link checks.

**Files likely touched:**
- `docs/reference/steps.md` — malformed-marker paragraph
- `docs/runbooks/stalled-or-stuck-feature.md` — malformed-marker recovery section

**Dependencies:** none

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3 → Task 4
Task 5 (independent)
```

## Integration Points

- After Task 3: a real `build_review` step over a git fixture fails fast with the named tokens and no reviewer dispatch.
- After Task 4: the full daemon/auto loop turns that failure into one bounded BUILD kickback, or a token-naming HALT at the cap. The mechanical allowance is never charged.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `testQuality` is enabled and a changed test declaration whose only Covers marker, introduced by this feature, is `// Covers: Task: 32`, when `build_review` runs, then it returns a failed step result carrying the malformed-marker list with that test file's repo-relative path, the marker's 1-based line, and the token `Task: 32`, and no rubric reviewer or coordinator is dispatched. | 1, 3 | "returns `success: false` with `buildReviewMalformedCovers` naming the path, line, and token, and the coordinator mock is never called" | diff-local |
| Story 1 happy: Given two changed test files each carrying one introduced malformed token on an unbound changed declaration, when `build_review` runs, then the failed result names both files with their lines and tokens. | 2, 3 | "asserts the output names every malformed file as `<path>:<line> token \`<token>\`` and ends with the accepted-forms line, for the one-file and two-file fixtures" | diff-local |
| Story 1 negative: Given a changed test declaration whose only introduced marker is the well-formed `// Covers: task:99` and the active plan has no Task 99, when `build_review` runs, then no malformed-marker list is produced, the rubric dispatch runs, and the candidate continues to the existing reviewer and `scope-incomplete` path. | 1, 3, 4 | "dispatches the coordinator once with frozen inputs whose `sourceSnapshot.testQuality.unresolvedMarkers` contains reference `task:99`" | diff-local |
| Story 1 negative: Given a changed test declaration carrying an introduced malformed token and also a Covers reference that resolves in the active feature, when `build_review` runs, then no malformed-marker list is produced and the rubric dispatch runs. | 1, 3 | "the resolving-sibling `task:1, Task: 32` tree carries no `buildReviewMalformedCovers` and dispatches the coordinator once" | diff-local |
| Story 1 negative: Given a changed test declaration whose malformed token was already present at the merge-base (not introduced by this feature), when `build_review` runs, then no malformed-marker list is produced. | 1 | "the merge-base-present marker" | diff-local |
| Story 1 negative: Given a changed test whose marker line yields only empty tokens (for example `// Covers:` followed by nothing, or a trailing comma), when `build_review` runs, then no malformed-marker list is produced. | 1 | "the empty-token `// Covers: ,` fixtures" | diff-local |
| Story 1 negative: Given `testQuality` is disabled and a changed test carries an introduced malformed token, when `build_review` runs, then no malformed-marker list is produced and the step behaves exactly as before. | 3 | "asserts that with `testQuality` disabled the malformed tree carries no `buildReviewMalformedCovers`, the coordinator mock is called once, and the step returns the coordinator's result unchanged" | diff-local |
| Story 2 happy: Given an auto-mode run whose `build_review` step returns the malformed-marker result and the `build_review` kickback budget is not exhausted, when the conductor handles the result, then it emits one `kickback` event from `build_review` to `build` whose evidence names each file, line, and token, sets the BUILD retry hint to that evidence plus the accepted grammars, restages `build_review` and `manual_test` as stale, and navigates to `build` without dispatching `build_review` a second time. | 3, 4 | "one `kickback` event `build_review`→`build` whose evidence names `src/a.test.ts:5` and `Task: 32`, and that the following `build` dispatch's retry hint contains that evidence and the line `Accepted forms: task:<id>, S<story>.<n>, FR-<n>.`" | diff-local |
| Story 2 happy: Given the same run, when the conductor handles the result, then `.pipeline/kickback-ledger.json` `gates.build_review.mechanicalFaults` and `lastMechanicalFault` are unchanged and the `build_review` gate kickback count increases by exactly one. | 4 | "the ledger `gates.build_review.count` rises by exactly 1 while `mechanicalFaults` and `lastMechanicalFault` are unchanged" | diff-local |
| Story 2 happy: Given the same run, when the step result is received, then no `step_retry` event is emitted for `build_review` and the step runner is invoked once for that lap. | 4 | "the `build_review` runner is invoked once in that lap with no `build_review` `step_retry` event" | diff-local |
| Story 2 negative: Given the malformed-marker result arrives when the `build_review` kickback budget is already at its cap, when the conductor handles the result, then it writes a `needs-human` HALT whose reason names each file, line, and token and the kickback cap, emits no `kickback` event, and leaves `mechanicalFaults` unchanged. | 4 | "writes a `needs-human` HALT naming `src/a.test.ts:5`, `Task: 32`, and `cap 2`, emits no `kickback` event, and leaves `mechanicalFaults` unchanged" | diff-local |
| Story 2 negative: Given an uncovered infrastructure failure on the `testQuality` rubric (for example a malformed provider result), when the conductor handles the lap, then it takes the existing mechanical lane and `mechanicalFaults` increases by one exactly as before this change. | 4 | "charged to the mechanical lane one fault per lap until `mechanicalFaults` is 3 with `lastMechanicalFault.reason` `provider-error`" | diff-local |
| Story 2 negative: Given a well-formed `task:<id>` naming a task absent from the active plan that the reviewer resolves `indeterminate`, when the conductor handles the lap, then it is recorded as `scope-incomplete` in the existing mechanical lane, not accepted. | 4 | "still asserting the indeterminate candidate is charged as `scope-incomplete` (`lastMechanicalFault.reason` `scope-incomplete`, `mechanicalFaults` 3), emits no kickback, and halts naming `scope-incomplete testQuality`, so it is not accepted" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
