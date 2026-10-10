**Status:** Accepted

# Stories: Marker-bearing tests outside test/-style paths are reviewed or reported (#2807)

Technical track (no PRD). Source: jstoup111/ai-conductor#2807. Tier: S.

**Intent.** Today `build_review` decides which changed files are tests for testQuality by path alone
(`src/conductor/src/engine/build-review-inputs.ts:451`, applied at `:641`). A changed file that
carries a `Covers:` marker but sits outside those path conventions — a `test_*.sh` outside `test/`,
a `*_test.go` beside its source — is dropped from testQuality scope with no finding, warning, or
event. Separately, three private definitions answer "is this path a test?" differently
(`gate-invalidation.ts:16`, `build-review-inputs.ts:451`, `build-review-test-quality-preflight.ts:234`).

Terms used below:

- **Well-formed marker:** a `Covers:` line yielding at least one FR (`FR-<n>`), story-criterion
  (`S<id>.<n>`), or `task:<id>` reference as parsed by `parseCoversMarkers`
  (`src/conductor/src/engine/covers-marker.ts:20`). A marker whose every token is unparseable is not
  well-formed.
- **Path conventions:** a path is a test by convention when any directory segment is `test`, `tests`,
  `__tests__`, or `spec` (case-insensitive), or its file name contains `.test.` or `.spec.` followed by
  an extension.

## Story 1: A marker-bearing test outside the path conventions is reviewed by testQuality

As an operator of a consumer project whose tests do not live under `test/`-style paths, I want
`build_review` to review a changed test that declares `Covers:` coverage wherever it lives, so that
coverage evidence is never ignored because of directory layout.

### Acceptance Criteria

#### Happy Path
- Given a feature diff that adds `src/widget/widget.check.ts`, which matches no path convention and contains a Vitest `it(...)` declaration preceded by a `// Covers: task:8` comment resolving to a task in the feature's plan, when build_review assembles its frozen inputs, then the testQuality scope lists that file among its in-scope tests and its counterfactual file selectors.
- Given a feature diff that adds `tools/test_widget.sh`, which matches no path convention and introduces a `# Covers: task:8` marker resolving to a task in the feature's plan, when build_review assembles its frozen inputs, then the file appears in the counterfactual file selectors as a concrete uncertain candidate, the same outcome the identical file receives at `test/test_widget.sh`.
- Given an admitted file that is a counterfactual selector and a changed production file in the same diff, when the testQuality preflight classifies the changed paths and builds its reverted checkout, then the admitted file is listed as a changed test, is absent from the reverted-production manifest, and the production file is reverted.

#### Negative Paths
- Given a changed `src/widget/widget.ts` outside the path conventions that carries no well-formed marker, when build_review assembles its frozen inputs, then the file is absent from the in-scope tests, the counterfactual file selectors, and the excluded-file records, and the preflight still reverts it as production.
- Given a changed production file outside the path conventions that carries a well-formed `// Covers: task:8` comment but declares no tests, when the preflight runs, then the file is not a changed test and is reverted as production.
- Given a changed file outside the path conventions whose only `Covers:` text yields no FR, criterion, or task reference (for example ``Covers:` comment lines``), when build_review assembles its frozen inputs, then the file is not admitted to testQuality scope and produces no excluded-file record.

### Done When
- [ ] An `assembleBuildReviewInputs` run over a fixture diff lists `src/widget/widget.check.ts` in `testQuality.inScopeTests` and `tools/test_widget.sh` in `testQuality.counterfactualFileSelectors`.
- [ ] The preflight's changed-test selectors include an admitted non-convention selector and its reverted-production manifest omits it while still reverting the production file.
- [ ] Unmarked and malformed-marker non-convention files appear in no testQuality scope list.

## Story 2: A marker-bearing file that cannot be reviewed is reported as excluded

As an operator, I want any marker-bearing file that `build_review` admitted but could not put under
review to be named on the event spine with the reason, so that an ignored coverage claim is never
silent.

### Acceptance Criteria

#### Happy Path
- Given an admitted non-convention changed file that yields neither an established review target nor a concrete candidate, when build_review settles its testQuality scope, then the `build_review_scope_summary` event persisted to `.pipeline/events.jsonl` carries an `excludedMarkerFiles` entry naming that file's path and a reason.
- Given an excluded file, when its reason is derived, then the reason is the file's first declaration-uncertainty diagnostic reason (for example `unsupported-source-language`) when the analyzer reported one, otherwise `no-changed-test-declarations` when no test declaration changed, otherwise `no-current-feature-binding`.
- Given a feature whose only marker-bearing change is an excluded file, so testQuality settles as the empty-scope PASS without dispatching a reviewer, when build_review completes, then the `build_review_scope_summary` event still carries that file's `excludedMarkerFiles` entry.

#### Negative Paths
- Given a feature with no excluded file, when the `build_review_scope_summary` event is emitted, then it carries no `excludedMarkerFiles` field and its other fields are unchanged.
- Given a marker-bearing changed file that matches a path convention but yields no review target, when build_review settles its testQuality scope, then that file produces no `excludedMarkerFiles` entry.

### Done When
- [ ] `build_review_scope_summary` declares an optional `excludedMarkerFiles` field of `{ selector, reason }` entries, emitted only when non-empty.
- [ ] A run that feeds `assembleBuildReviewInputs` output into `coordinateBuildReviewRubrics` with an empty-scope feature emits a scope summary naming the excluded file and its reason.

## Story 3: Every gate classifies a path as a test the same way

As a harness maintainer, I want one path-convention answer to "is this a test?", so that
build_review, the testQuality preflight, gate invalidation, rebase supersession, and autoresolve
never disagree about the same path.

### Acceptance Criteria

#### Happy Path
- Given each path in the table `test/a.ts`, `tests/unit/runner.spec.mts`, `spec/models/widget_test.rb`, `src/__tests__/helper.ts`, `src/a.test.ts`, `src/a.spec.ts`, `Tests/Foo.cs`, `src/a.ts`, `scripts/test_a.sh`, `pkg/a_test.go`, when gate invalidation's `isTestPath` and the preflight's path classification (tests plus test support) are asked, then both return the same test-or-not answer for every path, and that answer matches the path conventions.
- Given a path newly recognized by the shared conventions but not by the previous gate-invalidation rule (`tests/unit/runner.spec.mts`, `src/a.spec.ts`, `Tests/Foo.cs`), when gate invalidation partitions a delta containing it, then the path is classified as a test and not as runtime source.

#### Negative Paths
- Given `src/a.ts`, `scripts/test_a.sh`, or `pkg/a_test.go`, when any of those gates classifies the path, then every gate answers not-a-test; only build_review's marker admission (Story 1) can bring such a file into testQuality scope.

### Done When
- [ ] Exactly one path-convention predicate exists in the engine; `gate-invalidation.ts`, `build-review-inputs.ts`, and `build-review-test-quality-preflight.ts` define no private test-path regex of their own.
- [ ] A table test asserts identical answers from gate invalidation and the preflight classification for every listed path.
