# Custom steps crash the conductor with `STEP_ARTIFACT_CONTRACTS[step] is not iterable`

**Status:** Accepted

**Source:** jstoup111/ai-conductor#1840
**Track:** technical (see `.docs/track/custom-steps-crash-the-conductor-with-step-artifac.md`)
**Tier:** S

## Context

`STEP_ARTIFACT_CONTRACTS` enumerates built-in steps only. Config-declared custom steps
(`maintain-documentation`, `release-disposition` in this repository) have no key, and three
reads index the map without a guard. The conductor's post-success artifact-review block is
gated on "is completion-checked", which is true for any custom step carrying a
`completion_artifact`, so in non-auto mode (`inline --from`) a custom step reaches the unguarded
read and the run dies with `TypeError: STEP_ARTIFACT_CONTRACTS[step] is not iterable`, leaving
the step `in_progress` despite its PASS marker and a `needs-human` HALT carrying only a stack
trace. The daemon runs in auto mode and never enters the block.

Scope boundary (binding): absent contract key behaves as an empty contract list; the review
gate runs only for steps that declare reviewable artifacts. Custom `completion_artifact`
markers stay completion signals, not reviewable artifacts (adr-2026-07-25 stands). No step is
required to declare a contract, so no "missing contract" error is introduced.

## Story 1: A step with no artifact contract resolves to an empty artifact set

As the conductor, I want every read of a step's artifact contracts to treat an absent step as an
empty contract list, so that a config-declared custom step behaves exactly like the built-in
steps that declare `[]` instead of throwing.

### Acceptance Criteria

#### Happy Path
- Given a step name with no entry in the artifact-contract table, when the engine resolves that step's artifact files against a directory containing arbitrary `.docs/` and `.pipeline/` files, then the result is an empty file list with no diagnostic and no exception.
- Given a step name with no entry in the artifact-contract table, when the engine validates feature-artifact stems for that step over a list of paths that do not match the feature identity, then it reports zero violations and no exception.
- Given a step name with no entry in the artifact-contract table, when the engine asks whether that step's feature-artifact patterns are recursive, then it answers `false` without throwing.
- Given a built-in step that declares `[]` (for example `complexity`), when the engine resolves its artifact files, then the outcome is identical to the outcome for a step with no entry at all.

#### Negative Paths
- Given a built-in step that declares feature-scoped contracts (for example `plan`) and two candidate files neither of which matches the feature identity, when the engine resolves that step's artifact files, then it still returns the `ambiguous` diagnostic naming the step and the expected stem, unchanged by this fix.
- Given a step name with no entry in the artifact-contract table and a non-empty list of extra globs, when the engine resolves that step's artifact files, then the extra globs are still matched and returned, so an absent contract key never discards caller-supplied globs.

### Done When
- [ ] A single accessor in `src/conductor/src/engine/artifacts.ts` is the only read path for a step's artifact contracts and returns an empty readonly list for any step without an entry; no call site indexes the table directly.
- [ ] Unit tests in `test/engine/artifacts.test.ts` call `resolveArtifactFiles`, `validateFeatureArtifactStems`, and `featureArtifactPatternsAreRecursive` with a step name absent from the table and assert empty files / zero violations / `false`, and these tests fail against the pre-change accessor-less code with `is not iterable`.
- [ ] Existing `artifacts.test.ts` and `artifact-resolution-wiring.test.ts` suites pass unchanged.

## Story 2: The artifact-review gate runs only for steps that declare reviewable artifacts

As an operator running the conductor in default or interactive mode, I want the post-step
artifact-review gate to run only when the step actually declares reviewable artifacts, so that a
custom step whose only completion signal is a `.pipeline/` marker advances without a review
prompt, without a crash, and without weakening its completion check.

### Acceptance Criteria

#### Happy Path
- Given a config declaring a custom step with a `completion_artifact` under `.pipeline/` and a conductor constructed in `default` mode, when that step's skill writes the marker and the step succeeds, then the conductor records the step `done`, emits no artifact-review prompt for it, and advances to the following step with no HALT written.
- Given a built-in step with feature-scoped artifact contracts (for example `plan`) and a conductor in `default` mode with `review: manual`, when the step succeeds with an unapproved artifact on disk, then the artifact-review prompt is still raised for that artifact exactly as before.
- Given the `acceptance_specs` step with `acceptance_spec_globs` configured and a conductor in `default` mode with `review: manual`, when the step succeeds with a spec file matching only the configured extra glob, then the artifact-review gate still considers that file.

#### Negative Paths
- Given a config declaring a custom step with a `completion_artifact` and a conductor in `default` mode, when the step's skill exits without writing the marker, then the completion check still fails the step naming the configured `completion_artifact` path, and no `TypeError` reaches the HALT or the console.
- Given a built-in step whose completion is decided by a custom completion predicate but whose contract list is empty (for example `worktree`), when the step succeeds in `default` mode with `review: manual`, then no artifact-review prompt is raised and the step still completes.
- Given a conductor constructed in `auto` mode over the same custom-step config, when the custom step succeeds, then behavior is unchanged from today: no review gate, step recorded `done`.

### Done When
- [ ] `src/conductor/src/engine/conductor.ts` gates the post-success artifact-review block on a predicate meaning "this step declares reviewable artifacts" (non-empty artifact contracts or non-empty extra artifact globs for the step), not on `stepHasCompletionCheck`; `stepHasCompletionCheck` keeps governing completion checks.
- [ ] An engine test drives `Conductor.run` in `default` mode over a config with a custom step carrying a `completion_artifact`, asserts the step reaches `done`, the run advances past it, and no HALT is written; the same test fails against pre-change code with `STEP_ARTIFACT_CONTRACTS[step] is not iterable`.
- [ ] Tests assert the review prompt still fires for a contract-declaring built-in step and for an `acceptance_specs` extra glob in `default` mode with `review: manual`.
- [ ] A test asserts a custom step with a missing `completion_artifact` still fails its completion check in `default` mode.

## Story 3: `inline --from` recovers a pipeline through its custom SHIP-tail steps

As an operator following the stalled-feature runbook, I want `ai-conductor inline --from
<custom-step>` to run the repository's config-declared custom steps to completion and advance,
so that manual recovery works on repositories that declare custom steps.

### Acceptance Criteria

#### Happy Path
- Given a project config declaring two chained custom steps (the second `after:` the first, both with `completion_artifact` markers) and a state file positioned at the first, when `inline --from <first-custom-step>` runs in default mode with a step runner that writes each marker, then both steps are recorded `done` in the state file, the run proceeds to the step following the second, and `.pipeline/HALT` does not exist.

#### Negative Paths
- Given the same config, when the second custom step's runner exits without writing its marker, then the state file records that step as not done, the run stops with a failure that names the step and its `completion_artifact` path, and the first custom step's `done` status is preserved.

### Done When
- [ ] An acceptance test under `test/acceptance/` builds a temporary project with two chained custom steps, runs the conductor in default mode from the first custom step through faithful fakes, and asserts both steps `done`, advancement past them, and no `.pipeline/HALT`.
- [ ] The same suite asserts the missing-marker negative path names the step and marker path and preserves the earlier step's `done` status.
