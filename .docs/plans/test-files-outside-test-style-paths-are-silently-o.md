# Implementation Plan: Marker-bearing tests outside test/-style paths are reviewed or reported (#2807)

**Date:** 2026-10-09
**Design:** none (technical track, Tier S; approach recorded in `.docs/track/test-files-outside-test-style-paths-are-silently-o.md`)
**Stories:** .docs/stories/test-files-outside-test-style-paths-are-silently-o.md
**Conflict check:** Skipped (Tier S)

## Summary

Make `build_review`'s testQuality scope admit changed files that carry a well-formed `Covers:`
reference regardless of path, report admitted files that still cannot be reviewed on the existing
`build_review_scope_summary` event, keep the testQuality preflight from reverting admitted tests as
production, and replace three divergent test-path predicates with one. Four tasks.

## Technical Approach

Verified current state (origin/main == local main at `e6b56fe3da`):

- `snapshotTypedTestScope` in `src/conductor/src/engine/build-review-inputs.ts:617` builds the set of
  files to analyze from changed paths plus plan `Files` hints, filtered by a private `isTestPath`
  (`build-review-inputs.ts:451`, applied at `:641`). Anything outside that predicate is never read,
  never analyzed, and never reported.
- The analyzer (`analyzeBuildReviewTestScope`, `build-review-test-scope.ts:569`) is path-agnostic.
  For TS/JS it binds `Covers:` comments to declarations; for an unsupported language it emits a
  `declaration-uncertainty` note and turns introduced feature-resolvable markers into a concrete
  candidate (`build-review-test-scope.ts:582-588`, `:715-737`). The existing test
  `retains a marker-only unsupported Go test as a source-bound uncertainty candidate`
  (`src/conductor/test/engine/build-review-inputs.test.ts:525`) shows that outcome for `test/widget_test.go`.
- The testQuality preflight classifies changed paths by its own private predicate
  (`build-review-test-quality-preflight.ts:234-249`, `classifyTautologyPaths`) and reverts every
  `production` path to merge-base bytes (`:416`). `DefaultStepRunner.runTautologyPreflight`
  (`step-runners.ts:4687`) uses the same classifier and short-circuits to the `empty-test-set`
  approved exception when `classified.tests` is empty (`:4693`).
- `gate-invalidation.ts:16` exports a third predicate (`.test.` anywhere, or a `test`/`__tests__`
  segment). It is re-used by `rebase.ts` (supersession excusal, `:1914`) and `autoresolve.ts`
  (`classifyConflictScope`, `:57`).
- `build_review_scope_summary` (`src/conductor/src/types/events.ts:691`) is emitted by
  `emitScopeSummary` (`build-review-coordinator.ts:219`) on every testQuality settlement path,
  including the empty-scope PASS (`:562`), and its sink policy is `persist: true`
  (`event-sinks.ts:71`).

Design:

1. **One predicate module.** New `src/conductor/src/engine/test-path.ts` exports
   `isTestFilePath(path)` (file name matches `/\.(?:test|spec)\.[^/]+$/i`, or `(_test|_spec).<ext>`
   beneath a test-tree segment — exactly the preflight's current `isTestPath`),
   `isTestSupportPath(path)` (any segment `test|tests|__tests__|spec`, case-insensitive — the
   preflight's current rule) and `isTestPath(path) = isTestFilePath(path) || isTestSupportPath(path)`.
   This is the union of today's three rules, so no path that any gate currently treats as a test
   stops being one, except a directory name containing `.test.` (gate-invalidation's substring rule);
   `git ls-files` shows no such path in this repository. `gate-invalidation.ts` re-exports the shared
   `isTestPath` so `rebase.ts` and `autoresolve.ts` imports stay unchanged. Newly recognized there:
   `tests/` and `spec/` segments, `.spec.` file names, and case variants such as `Tests/`.
2. **Marker admission.** In `snapshotTypedTestScope`, for each changed non-deleted path where
   `isTestPath(path)` is false, read HEAD bytes with `source.readRequired(path)` and admit the path
   when `parseCoversMarkers(text)` (`covers-marker.ts:20`) yields at least one reference whose kind
   is not `unresolved`. Admitted paths join the analyzed set and go through the unchanged analyzer.
   Plan `Files` hints are not content-admitted (an unchanged file has nothing to review).
3. **Excluded-file record.** `BuildReviewTestQualityScope` (`build-review-inputs.ts:212`) gains
   optional `excludedMarkerFiles: readonly { selector: string; reason: BuildReviewExcludedMarkerReason }[]`,
   always set by the producer, sorted by selector. Only admitted (non-convention) files can appear.
   An admitted file is excluded when it is not in `counterfactualFileSelectors` (no target, no
   candidate). Reason: the reason of its first `declaration-uncertainty` note's diagnostic
   (`TestDeclarationUncertaintyReason`, `build-review-test-declarations.ts:29`), else
   `no-changed-test-declarations` when `scope.changedDeclarations` is empty, else
   `no-current-feature-binding`.
4. **Preflight agreement.** `classifyTautologyPaths(paths, admittedTests = [])` moves any changed
   path present in `admittedTests` into `tests`. `materializeTautologyPreflight` passes
   `deps.counterfactualFileSelectors ?? []`; `runTautologyPreflight` passes
   `inputs.sourceSnapshot.testQuality?.counterfactualFileSelectors ?? []`. A marker-bearing
   production file that is not a selector (no test declarations) stays `production` and is reverted.
5. **Event.** `build_review_scope_summary` gains optional
   `excludedMarkerFiles?: readonly { selector: string; reason: string }[]`, set by `emitScopeSummary`
   from `sourceSnapshot.testQuality.excludedMarkerFiles` only when non-empty. Per
   `.agents/skills/event-spine/SKILL.md` §2 this is an additive optional field on an existing variant;
   no new variant, ledger, or render policy. The frozen scope field is state (exception C), the event
   is the occurrence.

Gate invalidation, rebase, and autoresolve stay path-only by decision (see the track file): a
marker-bearing file outside the conventions counts as runtime source there, the conservative
direction.

## Prerequisites

- None.

## Tasks

### Task 1: One shared test-path predicate for every gate

**Story:** Story 3 (S3.1, S3.2, S3.3)
**Type:** refactor

**Steps:**
1. Write failing test `src/conductor/test/engine/test-path.test.ts`: a table over `test/a.ts`, `tests/unit/runner.spec.mts`, `spec/models/widget_test.rb`, `src/__tests__/helper.ts`, `src/a.test.ts`, `src/a.spec.ts`, `Tests/Foo.cs` (expected test) and `src/a.ts`, `scripts/test_a.sh`, `pkg/a_test.go` (expected not-a-test). For each path assert `isTestPath` imported from `gate-invalidation.ts` equals the expectation and equals whether `classifyTautologyPaths([path])` puts it in `tests` or `testSupport`.
2. Add to `src/conductor/test/engine/gate-invalidation.test.ts`: `partitionDelta(['tests/unit/runner.spec.mts', 'src/a.spec.ts', 'Tests/Foo.cs'], [])` returns all three in `test`, and `isRuntimeSourcePath` is false for each.
3. Verify RED (gate invalidation currently answers not-a-test for `tests/unit/runner.spec.mts`, `src/a.spec.ts`, and `Tests/Foo.cs`).
4. Implement `src/conductor/src/engine/test-path.ts` with `isTestFilePath`, `isTestSupportPath`, `isTestPath` as in Technical Approach §1. Replace the private predicates in `gate-invalidation.ts` (re-export `isTestPath` from the new module), `build-review-inputs.ts`, and `build-review-test-quality-preflight.ts` with imports.
5. Verify GREEN, including the existing `classifyTautologyPaths` expectations in `build-review-test-quality-preflight.test.ts`.
6. Commit: "refactor(engine): one shared test-path predicate for every gate".

**Done when:**
- [test] `test-path.test.ts` asserts that for each of the ten listed paths gate invalidation's `isTestPath` and `classifyTautologyPaths` (tests or testSupport) give the same answer, which is test for the first seven paths and not-a-test for `src/a.ts`, `scripts/test_a.sh`, and `pkg/a_test.go`.
- [test] `gate-invalidation.test.ts` asserts `partitionDelta` places `tests/unit/runner.spec.mts`, `src/a.spec.ts`, and `Tests/Foo.cs` in its `test` partition and `isRuntimeSourcePath` returns false for each.
- `gate-invalidation.ts`, `build-review-inputs.ts`, and `build-review-test-quality-preflight.ts` contain no `function isTestPath` or `function isTestSupportPath` definition and no test-path regex of their own, and import their path classification from `src/conductor/src/engine/test-path.ts`.
- The pre-existing `classifyTautologyPaths` expectations in `build-review-test-quality-preflight.test.ts` pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/test-path.ts` — new shared predicate module
- `src/conductor/src/engine/gate-invalidation.ts` — re-export shared `isTestPath`
- `src/conductor/src/engine/build-review-inputs.ts` — import shared predicate
- `src/conductor/src/engine/build-review-test-quality-preflight.ts` — import shared predicates
- `src/conductor/test/engine/test-path.test.ts` — new table test
- `src/conductor/test/engine/gate-invalidation.test.ts` — newly recognized paths

**Dependencies:** none

### Task 2: Admit marker-bearing changed files to testQuality scope and record exclusions

**Story:** Story 1 (S1.1, S1.2, S1.4, S1.6), Story 2 (S2.2, S2.5)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-inputs.test.ts` using the existing `fakeGit` pattern with plan body `### Task 8: typed scope\n` (as at `:525`):
   - (a) diff adds `src/widget/widget.check.ts` whose HEAD is `// Covers: task:8\nit('widget', () => {});\n`, plus `src/widget/widget.ts`, `scripts/test_a.sh`, and `pkg/a_test.go` with no marker: `testQuality.inScopeTests` and `counterfactualFileSelectors` equal `['src/widget/widget.check.ts']`; the three unmarked files are in neither and not in `excludedMarkerFiles`.
   - (b) diff adds `tools/test_widget.sh` (`# Covers: task:8\n`): `counterfactualFileSelectors` contains it and `testScope.candidates` has one entry for it with reason `unsupported-declaration`; the same fixture at `test/test_widget.sh` yields an identical candidate shape.
   - (c) diff changes `tools/old_check.sh` (`# Covers: task:99`), `src/hints.ts` (`// Covers: task:8\nexport const x = 1;\n`), `src/spec-text.ts` (`` // Covers:` comment lines ``), and an `src/widget/other.check.ts` with a changed `it(...)` under `// Covers: task:99`: `excludedMarkerFiles` equals, sorted by selector, `{ selector: 'src/hints.ts', reason: 'no-changed-test-declarations' }`, `{ selector: 'src/widget/other.check.ts', reason: 'no-current-feature-binding' }`, `{ selector: 'tools/old_check.sh', reason: 'unsupported-source-language' }`; `src/spec-text.ts` is in no scope list and has no record.
   - (d) precedence: diff changes `src/widget/multi.check.ts` under `// Covers: task:99` containing, in source order, an `it(titleVar, ...)` (nonliteral title) and then an unsupported declaration wrapper, plus a literal `it('changed', ...)`: its record's reason is `nonliteral-declaration-title` (first diagnostic wins over later diagnostics and over `no-current-feature-binding`); `tools/old_check.sh` (diagnostic and no changed declarations) gets `unsupported-source-language`, not `no-changed-test-declarations`.
   - (e) diff changes `test/helpers.ts` with `// Covers: task:8` and no declarations: `excludedMarkerFiles` is empty.
2. Verify RED.
3. Implement Technical Approach §2 and §3 in `snapshotTypedTestScope` and the `BuildReviewTestQualityScope` type (add exported `BuildReviewExcludedMarkerFile` and `BuildReviewExcludedMarkerReason`).
4. Verify GREEN.
5. Commit: "feat(build-review): admit marker-bearing tests outside test paths and record exclusions".

**Done when:**
- [test] An `assembleBuildReviewInputs` test asserts `testQuality.inScopeTests` and `testQuality.counterfactualFileSelectors` both equal `['src/widget/widget.check.ts']` for a non-convention file with an `it(...)` under `// Covers: task:8`, while the unmarked `src/widget/widget.ts`, `scripts/test_a.sh`, and `pkg/a_test.go` appear in neither list nor in `excludedMarkerFiles`.
- [test] An `assembleBuildReviewInputs` test asserts `tools/test_widget.sh` with `# Covers: task:8` is in `testQuality.counterfactualFileSelectors` as one `unsupported-declaration` candidate, matching the candidate produced for the same file at `test/test_widget.sh`.
- [test] An `assembleBuildReviewInputs` test asserts `testQuality.excludedMarkerFiles` equals exactly the three records `src/hints.ts`/`no-changed-test-declarations`, `src/widget/other.check.ts`/`no-current-feature-binding`, `tools/old_check.sh`/`unsupported-source-language`, and that `src/spec-text.ts` (malformed marker only) is absent from `inScopeTests`, `counterfactualFileSelectors`, and `excludedMarkerFiles`.
- [test] An `assembleBuildReviewInputs` test asserts a marker-bearing `test/helpers.ts` with no declarations yields an empty `excludedMarkerFiles`.
- [test] An `assembleBuildReviewInputs` precedence test asserts `src/widget/multi.check.ts`, whose first diagnostic is `nonliteral-declaration-title` followed by a later diagnostic and which also has a changed unbound declaration, is recorded with reason `nonliteral-declaration-title`, and `tools/old_check.sh`, which has a diagnostic and no changed test declarations, is recorded with `unsupported-source-language` rather than `no-changed-test-declarations`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — admission, exclusion records, scope type
- `src/conductor/test/engine/build-review-inputs.test.ts` — admission and exclusion tests

**Dependencies:** Task 1

### Task 3: The testQuality preflight keeps admitted tests at HEAD

**Story:** Story 1 (S1.3, S1.4, S1.5)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-test-quality-preflight.test.ts`:
   - `materializeTautologyPreflight` over a diff changing `src/widget/widget.check.ts`, `src/widget/widget.ts`, and `src/hints.ts` with `counterfactualFileSelectors: ['src/widget/widget.check.ts']`: the result's `changedTestSelectors` contains `src/widget/widget.check.ts`; `revertedProductionManifest` paths equal `['src/hints.ts', 'src/widget/widget.ts']`; no merge-base write targets `src/widget/widget.check.ts`.
   - `classifyTautologyPaths(['src/widget/widget.check.ts', 'src/a.ts'], ['src/widget/widget.check.ts', 'test/unchanged.test.ts'])` returns `tests: ['src/widget/widget.check.ts']`, `production: ['src/a.ts']` (an admitted selector absent from the changed paths is not added).
   - Through `DefaultStepRunner`'s build_review preflight path (as the existing tests in this file reach it): frozen inputs whose diff changes only `src/widget/widget.check.ts` and `src/widget/widget.ts`, with `testQuality.counterfactualFileSelectors: ['src/widget/widget.check.ts']`, do not settle as the `empty-test-set` approved exception.
2. Verify RED.
3. Implement Technical Approach §4.
4. Verify GREEN.
5. Commit: "fix(build-review): preflight treats engine-admitted tests as tests".

**Done when:**
- [test] A `materializeTautologyPreflight` test asserts an admitted selector `src/widget/widget.check.ts` is in the result's `changedTestSelectors`, is absent from `revertedProductionManifest`, and is never written with merge-base bytes, while `src/widget/widget.ts` and the marker-bearing non-selector `src/hints.ts` are both in `revertedProductionManifest` and `src/hints.ts` is absent from `changedTestSelectors`.
- [test] A `classifyTautologyPaths` test asserts an admitted path is classified `tests` only when it is among the changed paths, and that omitting the second argument leaves the classification identical to the path-only result.
- [test] A `DefaultStepRunner` build_review preflight test asserts a diff whose only test is the admitted selector `src/widget/widget.check.ts` does not produce the `empty-test-set` approved exception.

**Files likely touched:**
- `src/conductor/src/engine/build-review-test-quality-preflight.ts` — `classifyTautologyPaths` admitted argument, materialize wiring
- `src/conductor/src/engine/step-runners.ts` — pass counterfactual selectors to the classifier
- `src/conductor/test/engine/build-review-test-quality-preflight.test.ts` — preflight tests

**Dependencies:** Task 1

### Task 4: Report excluded marker files on the scope summary event

**Story:** Story 2 (S2.1, S2.3, S2.4)
**Type:** happy-path

**Steps:**
1. Write failing tests:
   - In `src/conductor/test/engine/build-review-coordinator.test.ts`: frozen inputs produced by `assembleBuildReviewInputs` (the `fakeGit` fixture pattern from `build-review-inputs.test.ts`) for a diff whose only marker-bearing change is `tools/old_check.sh` (`# Covers: task:99`), passed to `coordinateBuildReviewRubrics` with testQuality enabled and a recording `emit`: the outcome is `passed` with reason `test_quality_empty_scope`, and exactly one `build_review_scope_summary` event carries `excludedMarkerFiles: [{ selector: 'tools/old_check.sh', reason: 'unsupported-source-language' }]`.
   - In the same file: the existing scope-summary expectation (`:358`) for a feature with no excluded file still `toEqual`s the event without an `excludedMarkerFiles` key.
   - An `EventPersister` test: a `build_review_scope_summary` event carrying `excludedMarkerFiles` emitted on a started persister's emitter is appended to `.pipeline/events.jsonl` with the field intact.
2. Verify RED.
3. Implement Technical Approach §5 in `src/conductor/src/types/events.ts` and `emitScopeSummary`.
4. Update `docs/reference/steps.md` (the `build_review` paragraph at `:66`) to state the path conventions, that a changed file with a well-formed `Covers:` reference is analyzed wherever it lives, and that an admitted file that cannot be reviewed is named with its reason on the `build_review_scope_summary` event.
5. Verify GREEN.
6. Commit: "feat(build-review): name excluded marker files on the scope summary event".

**Done when:**
- [test] A test feeding `assembleBuildReviewInputs` output for a diff whose only marker-bearing change is `tools/old_check.sh` into `coordinateBuildReviewRubrics` asserts the outcome is the `test_quality_empty_scope` PASS and the emitted `build_review_scope_summary` carries `excludedMarkerFiles` equal to `[{ selector: 'tools/old_check.sh', reason: 'unsupported-source-language' }]`.
- [test] A coordinator test asserts that for a feature with no excluded file the emitted `build_review_scope_summary` deep-equals the pre-change shape with no `excludedMarkerFiles` key.
- [test] An `EventPersister` test asserts a `build_review_scope_summary` event with `excludedMarkerFiles` is appended to `.pipeline/events.jsonl` and the parsed line retains the `excludedMarkerFiles` entries.
- `docs/reference/steps.md` describes the path conventions, content admission by a well-formed `Covers:` reference, and the `excludedMarkerFiles` report on `build_review_scope_summary`.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — optional `excludedMarkerFiles` on `build_review_scope_summary`
- `src/conductor/src/engine/build-review-coordinator.ts` — `emitScopeSummary` carries exclusions
- `src/conductor/test/engine/build-review-coordinator.test.ts` — integration and shape tests
- `src/conductor/test/engine/event-persister.test.ts` — persistence round-trip
- `docs/reference/steps.md` — build_review scope description

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 4
   └─────▶ Task 3
```

## Integration Points

- After Task 2: `assembleBuildReviewInputs` admits and records non-convention marker files.
- After Task 3: the build_review preflight (via `DefaultStepRunner`) keeps admitted tests at HEAD.
- After Task 4: the exclusion reaches the event spine through `coordinateBuildReviewRubrics`; Task 4
  owns the cross-boundary integration proof for the report.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a feature diff that adds `src/widget/widget.check.ts`, which matches no path convention and contains a Vitest `it(...)` declaration preceded by a `// Covers: task:8` comment resolving to a task in the feature's plan, when build_review assembles its frozen inputs, then the testQuality scope lists that file among its in-scope tests and its counterfactual file selectors. | 2 | "asserts `testQuality.inScopeTests` and `testQuality.counterfactualFileSelectors` both equal `['src/widget/widget.check.ts']`" | diff-local |
| Story 1 happy: Given a feature diff that adds `tools/test_widget.sh`, which matches no path convention and introduces a `# Covers: task:8` marker resolving to a task in the feature's plan, when build_review assembles its frozen inputs, then the file appears in the counterfactual file selectors as a concrete uncertain candidate, the same outcome the identical file receives at `test/test_widget.sh`. | 2 | "is in `testQuality.counterfactualFileSelectors` as one `unsupported-declaration` candidate, matching the candidate produced for the same file at `test/test_widget.sh`" | diff-local |
| Story 1 happy: Given an admitted file that is a counterfactual selector and a changed production file in the same diff, when the testQuality preflight classifies the changed paths and builds its reverted checkout, then the admitted file is listed as a changed test, is absent from the reverted-production manifest, and the production file is reverted. | 3 | "is in the result's `changedTestSelectors`, is absent from `revertedProductionManifest`, and is never written with merge-base bytes, while `src/widget/widget.ts` and the marker-bearing non-selector `src/hints.ts` are both in `revertedProductionManifest`" | diff-local |
| Story 1 negative: Given a changed `src/widget/widget.ts` outside the path conventions that carries no well-formed marker, when build_review assembles its frozen inputs, then the file is absent from the in-scope tests, the counterfactual file selectors, and the excluded-file records, and the preflight still reverts it as production. | 2, 3 |  "while the unmarked `src/widget/widget.ts`, `scripts/test_a.sh`, and `pkg/a_test.go` appear in neither list nor in `excludedMarkerFiles`"  | diff-local |
| Story 1 negative: Given a changed production file outside the path conventions that carries a well-formed `// Covers: task:8` comment but declares no tests, when the preflight runs, then the file is not a changed test and is reverted as production. | 3 | "the marker-bearing non-selector `src/hints.ts` are both in `revertedProductionManifest`" | diff-local |
| Story 1 negative: Given a changed file outside the path conventions whose only `Covers:` text yields no FR, criterion, or task reference (for example ``Covers:` comment lines``), when build_review assembles its frozen inputs, then the file is not admitted to testQuality scope and produces no excluded-file record. | 2 | "`src/spec-text.ts` (malformed marker only) is absent from `inScopeTests`, `counterfactualFileSelectors`, and `excludedMarkerFiles`" | diff-local |
| Story 2 happy: Given an admitted non-convention changed file that yields neither an established review target nor a concrete candidate, when build_review settles its testQuality scope, then the `build_review_scope_summary` event persisted to `.pipeline/events.jsonl` carries an `excludedMarkerFiles` entry naming that file's path and a reason. | 4 |  "is appended to `.pipeline/events.jsonl` and the parsed line retains the `excludedMarkerFiles` entries"  | diff-local |
| Story 2 happy: Given an excluded file, when its reason is derived, then the reason is the file's first declaration-uncertainty diagnostic reason (for example `unsupported-source-language`) when the analyzer reported one, otherwise `no-changed-test-declarations` when no test declaration changed, otherwise `no-current-feature-binding`. | 2 |  "is recorded with reason `nonliteral-declaration-title`, and `tools/old_check.sh`, which has a diagnostic and no changed test declarations, is recorded with `unsupported-source-language` rather than `no-changed-test-declarations`"  | diff-local |
| Story 2 happy: Given a feature whose only marker-bearing change is an excluded file, so testQuality settles as the empty-scope PASS without dispatching a reviewer, when build_review completes, then the `build_review_scope_summary` event still carries that file's `excludedMarkerFiles` entry. | 4 | "asserts the outcome is the `test_quality_empty_scope` PASS and the emitted `build_review_scope_summary` carries `excludedMarkerFiles`" | diff-local |
| Story 2 negative: Given a feature with no excluded file, when the `build_review_scope_summary` event is emitted, then it carries no `excludedMarkerFiles` field and its other fields are unchanged. | 4 | "for a feature with no excluded file the emitted `build_review_scope_summary` deep-equals the pre-change shape with no `excludedMarkerFiles` key" | diff-local |
| Story 2 negative: Given a marker-bearing changed file that matches a path convention but yields no review target, when build_review settles its testQuality scope, then that file produces no `excludedMarkerFiles` entry. | 2 | "a marker-bearing `test/helpers.ts` with no declarations yields an empty `excludedMarkerFiles`" | diff-local |
| Story 3 happy: Given each path in the table `test/a.ts`, `tests/unit/runner.spec.mts`, `spec/models/widget_test.rb`, `src/__tests__/helper.ts`, `src/a.test.ts`, `src/a.spec.ts`, `Tests/Foo.cs`, `src/a.ts`, `scripts/test_a.sh`, `pkg/a_test.go`, when gate invalidation's `isTestPath` and the preflight's path classification (tests plus test support) are asked, then both return the same test-or-not answer for every path, and that answer matches the path conventions. | 1 | "gate invalidation's `isTestPath` and `classifyTautologyPaths` (tests or testSupport) give the same answer, which is test for the first seven paths and not-a-test for `src/a.ts`, `scripts/test_a.sh`, and `pkg/a_test.go`" | diff-local |
| Story 3 happy: Given a path newly recognized by the shared conventions but not by the previous gate-invalidation rule (`tests/unit/runner.spec.mts`, `src/a.spec.ts`, `Tests/Foo.cs`), when gate invalidation partitions a delta containing it, then the path is classified as a test and not as runtime source. | 1 | "asserts `partitionDelta` places `tests/unit/runner.spec.mts`, `src/a.spec.ts`, and `Tests/Foo.cs` in its `test` partition and `isRuntimeSourcePath` returns false for each" | diff-local |
| Story 3 negative: Given `src/a.ts`, `scripts/test_a.sh`, or `pkg/a_test.go`, when any of those gates classifies the path, then every gate answers not-a-test; only build_review's marker admission (Story 1) can bring such a file into testQuality scope. | 1, 2 |  "while the unmarked `src/widget/widget.ts`, `scripts/test_a.sh`, and `pkg/a_test.go` appear in neither list nor in `excludedMarkerFiles`"  | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
