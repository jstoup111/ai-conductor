# Implementation Plan: Fail closed when build_review cannot resolve which plan

**Date:** 2026-09-06
**Stories:** .docs/stories/fail-closed-when-build-review-cannot-resolve-which.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing gate contract — the caller-supplied plan override keeps precedence, the empty-scope PASS keeps its approved meaning, and the refusal reuses the established typed needs-human seam.

## Summary

Three bounded tasks deliver #2179: an additive plan-selection helper that says why selection failed, a build_review branch that refuses an unresolvable scope instead of publishing a PASS, and regression cases pinning the empty and resolvable scopes. Recording of the active plan, retry routing, halt classification, and rubric policy are outside this small slice.

## Technical Approach

The shared feature-plan resolver in `src/conductor/src/engine/artifacts.ts` collapses two very different situations onto one `undefined`: a project with no plan work at all, and a project whose plan corpus holds several candidates none of which can be attributed to the running feature. `runBuildReview` in `src/conductor/src/engine/step-runners.ts` reads that single `undefined` and publishes a durable passing verdict for both, so an unattributable feature is recorded as reviewed without any review happening.

Add one exported helper beside the existing resolver that returns a discriminated outcome — resolved with the absolute plan path, unresolvable with the sorted candidate paths, empty with no candidates. Move the current ladder body into it unchanged so the recorded-plan, singleton and stem-match rungs keep identical semantics and ordering, then reduce the existing path-returning resolver to a thin delegation that yields the resolved path and nothing for the two other kinds. That keeps all fourteen existing call sites of the path-returning resolver byte-identical, including the sibling coverage-binding step that already treats a missing plan as a step failure.

Only the build_review runner consumes the new outcome. Its precedence is unchanged: a caller-supplied plan path still wins outright. Otherwise the empty outcome keeps publishing the existing PASS verdict with its current reason selection, and the unresolvable outcome returns a failed step result carrying the established `needs-human` typed refusal whose reason names the unresolved feature description and every candidate plan stem. The refusal is returned before the verdict publisher runs, so the durable PASS artifact is never written on that path, and before any input assembly or grader dispatch, so no provider is contacted. A refusal is the right terminal shape rather than a kickback because re-dispatching the step cannot change its inputs: the plan corpus and the feature description are identical on the next lap, and plan authoring is not a supported daemon destination.

Follow the repository's existing test seams. Feature-plan resolution cases belong in the existing focused unit suite for that resolver, which already builds a temporary project directory, writes plan files, and writes the engine state file directly; extend it with the same builders rather than inventing a fixture shape. Build_review cases belong in the existing runner suite's build_review describe block, which constructs the step runner directly with an injected mock provider, a scripted Git runner, and a temporary project directory, and asserts on the returned step result plus the verdict file. Both are unit and integration seams with no third-party call; do not reach for a full conductor run to observe a single step's branch, and do not stub the branch under test.

## Preconditions and claim ledger

- Operator approved Small scope, the additive-helper approach, the technical track, and all three stories on 2026-09-06 (delegated).
- Verified: `resolveFeaturePlanPath` at `src/conductor/src/engine/artifacts.ts:733` returns the recorded active plan when present, the sole plan when the corpus holds exactly one, the stem-matched plan when a feature description is supplied, and `undefined` for both an empty corpus and an unresolvable multi-plan corpus.
- Verified: `runBuildReview` at `src/conductor/src/engine/step-runners.ts:2572` prefers the caller-supplied plan override, otherwise calls that resolver, and at `step-runners.ts:2590` maps every falsy result to `publishBuildReviewPass`.
- Verified: `publishBuildReviewPass` at `src/conductor/src/engine/step-runners.ts:2739` writes a `PASS` verdict artifact into the pipeline directory and stamps it, so the current behavior is durable, not advisory.
- Verified: the typed step refusal shape is declared at `src/conductor/src/engine/conductor.ts:1138` and consumed at `src/conductor/src/engine/conductor.ts:10108`, which writes a needs-human halt marker and emits the loop halt; `runCoverageBinding` at `src/conductor/src/engine/step-runners.ts:2566` is the existing production user of that shape.
- Verified: `src/conductor/test/engine/resolve-feature-plan-path.test.ts` already asserts the two `undefined` outcomes separately, so the preserved-behavior cases exist and need no new fixture.
- Verified: `src/conductor/test/engine/step-runners.test.ts` already carries a build_review case that observes the empty-scope PASS reason in both the step output and the verdict artifact.
- Verified: `adr-2026-09-06-engine-owned-test-quality-scope` decision 7 blesses the empty-scope PASS for a genuinely empty scope and is silent on plan-resolution ambiguity, so no approved decision is amended and no new decision record is required.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no new event, metric, span, log line, report, sidecar file, or poller — the refusal rides the existing halt-marker and loop-halt seam.
- Verify-claims verdict: CLEAR. Every path, symbol and line above was read in the worktree at authoring time. No load-bearing assumption remains open.

## Tasks

### Task 1: Report why feature-plan selection failed
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/test/engine/resolve-feature-plan-path.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing feature-plan resolution unit suite with failing cases for a new exported selection helper, reusing that file's temporary-directory and plan-writing builders: a recorded active plan, a single plan, a stem-matched plan among several, several plans with no stem match, several plans with no feature description at all, and an empty corpus.
2. Verify RED — the helper does not exist yet.
3. Implement the helper in the artifacts module as a discriminated result: resolved carrying the absolute plan path, unresolvable carrying the sorted candidate paths, empty carrying none. Move the current ladder body into it verbatim so rung order and semantics are unchanged.
4. Reduce the existing path-returning resolver to a thin delegation over the helper that yields the resolved path and nothing for the two other kinds, leaving its exported signature untouched.
5. Run the focused unit file through the project's scoped-run command and the typecheck target that covers test files, then commit.

**Done when:**
1. The selection helper reports a resolved outcome carrying the same absolute path the existing path-returning resolver returns for the recorded-plan, single-plan and stem-matched inputs.
2. The selection helper reports an unresolvable outcome listing every candidate path when several plans exist and none can be attributed, and an empty outcome when the corpus holds none.
3. Every pre-existing case in the feature-plan resolution suite passes unchanged, including the two cases that expect no path.
4. The exported signature of the existing path-returning resolver is unchanged and no call site outside this task's files is edited.

### Task 2: Refuse a build_review it cannot scope
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/step-runners.test.ts
**Dependencies:** 1

**Steps:**
1. Add a failing case to the existing build_review describe block in the runner suite: a temporary project holding several plan files whose stems match neither the runner's feature description nor any recorded active plan, the test-quality rubric opted in via the suite's existing helper, and an injected mock provider.
2. Assert the step returns a failed result carrying a needs-human typed refusal whose reason contains the feature description and every candidate plan stem, that no verdict file exists in the pipeline directory afterwards, and that the injected provider was never invoked.
3. Verify RED — today the step returns success with the empty-scope PASS reason and writes the verdict file.
4. Replace the runner's plan lookup with the Task 1 selection helper. Keep the caller-supplied plan override ahead of it. On the empty outcome publish the existing PASS with its current reason selection unchanged. On the unresolvable outcome return the failed result with the typed refusal, before the verdict publisher and before input assembly.
5. Add the override precedence case to the same block: the identical unresolvable corpus plus a caller-supplied plan path reaches ordinary review.
6. Run the focused runner tests through the project's scoped-run command and the typecheck target that covers test files, then commit.

**Done when:**
1. A build_review run over several unattributable candidate plans returns a failed step result whose needs-human refusal reason contains the unresolved feature description and every candidate plan stem.
2. That same run leaves no build-review verdict artifact in the pipeline directory and invokes no provider.
3. A caller-supplied plan path over the identical corpus still takes precedence, reaches ordinary review, and never raises the refusal.

### Task 3: Pin the genuinely empty and resolvable scopes
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/engine/step-runners.test.ts
**Dependencies:** 2

**Steps:**
1. Leave the pre-existing empty-scope build_review case unedited and confirm it still observes the empty-scope PASS reason in both the returned step output and the verdict artifact.
2. Add a runner case whose temporary project holds exactly one plan file, and another whose project holds several plans of which one stem matches the feature description, asserting each reaches ordinary review rather than any PASS shortcut.
3. Add a runner case with no plan files and no rubric enabled, asserting the existing no-rubrics PASS reason is published and no refusal is returned.
4. Run the focused runner tests through the project's scoped-run command and the typecheck target that covers test files, then commit.

**Done when:**
1. The pre-existing empty-scope case still succeeds unedited and its verdict artifact still records the empty-scope reason.
2. Single-plan and stem-matched multi-plan runner cases both reach ordinary review and publish no empty-scope PASS.
3. A run with no plan files and no rubric enabled publishes the no-rubrics PASS reason and returns no refusal.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given no engine-recorded active plan, several plan files on disk, and a feature description matching none of their stems, when the build_review step runs, then the step fails with a needs-human refusal whose reason names the unresolved feature description and every candidate plan stem. | 2 | "A build_review run over several unattributable candidate plans returns a failed step result whose needs-human refusal reason contains the unresolved feature description and every candidate plan stem." | diff-local |
| Story 1 happy: Given that same unresolvable state, when the build_review step runs, then no build-review verdict artifact is written and no grader provider is invoked. | 2 | "That same run leaves no build-review verdict artifact in the pipeline directory and invokes no provider." | diff-local |
| Story 1 negative: Given that same unresolvable state but a plan path supplied explicitly by the caller, when the build_review step runs, then it grades that plan and the ambiguity refusal is never raised. | 2 | "A caller-supplied plan path over the identical corpus still takes precedence, reaches ordinary review, and never raises the refusal." | diff-local |
| Story 2 happy: Given no plan files exist on disk and the test-quality rubric is opted in, when the build_review step runs, then it publishes the existing empty-scope PASS verdict with its current reason. | 3 | "The pre-existing empty-scope case still succeeds unedited and its verdict artifact still records the empty-scope reason." | diff-local |
| Story 2 happy: Given exactly one plan file on disk, or several plan files of which one stem matches the feature description, when the build_review step runs, then that plan is graded and no empty-scope PASS is published. | 3 | "Single-plan and stem-matched multi-plan runner cases both reach ordinary review and publish no empty-scope PASS." | diff-local |
| Story 2 negative: Given no plan files exist and no rubric is enabled, when the build_review step runs, then it publishes the existing no-rubrics PASS reason rather than any refusal. | 3 | "A run with no plan files and no rubric enabled publishes the no-rubrics PASS reason and returns no refusal." | diff-local |
| Story 3 happy: Given an engine-recorded active plan, a single plan file, or a stem-matched plan among several, when the plan selection helper runs, then it reports a resolved outcome carrying the same absolute path the existing path-returning resolver returns today. | 1 | "The selection helper reports a resolved outcome carrying the same absolute path the existing path-returning resolver returns for the recorded-plan, single-plan and stem-matched inputs." | diff-local |
| Story 3 happy: Given several plan files and no recorded plan and no stem match, when the plan selection helper runs, then it reports an unresolvable outcome listing every candidate path. | 1 | "The selection helper reports an unresolvable outcome listing every candidate path when several plans exist and none can be attributed, and an empty outcome when the corpus holds none." | diff-local |
| Story 3 negative: Given no plan files exist at all, when the plan selection helper runs, then it reports an empty outcome distinct from the unresolvable outcome, while the existing path-returning resolver still returns nothing for both. | 1 | "Every pre-existing case in the feature-plan resolution suite passes unchanged, including the two cases that expect no path." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled temporary-directory fixtures; no criterion depends on a commit outside this feature's diff. Task 1 owns the unit-level selection cases in the existing feature-plan resolution suite, which builds its own temporary project and writes plan and engine-state files directly. Task 2 owns the integration proof at the changed production boundary: the build_review step runner is the entry point every host reaches this behavior through, and its case constructs the runner with an injected mock provider and scripted Git runner and asserts the returned step result, the absence of the verdict artifact, and the absence of any provider call. Task 3 owns the preservation cases at that same boundary. No third-party service, real LLM, network call, or full conductor run is used; the existing suites' injected provider and Git runner remain the only boundaries faked. No terminal catch-all validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3

Small tier: architecture, conflict-check and coherence artifacts are skipped. No new architecture decision record or amendment is required, because the approved empty-scope PASS meaning is preserved and plan-resolution ambiguity is unaddressed by any existing decision.
