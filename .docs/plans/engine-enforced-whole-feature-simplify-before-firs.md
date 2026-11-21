# Implementation Plan: BUILD runs one whole-feature simplify pass before its first build_review

**Date:** 2026-11-21
**Design:** none (technical track); decision recorded in `.docs/decisions/adr-2026-08-03-uncommitted-work-floor-under-build-completion.md` (D9, appended 2026-11-21)
**Stories:** .docs/stories/engine-enforced-whole-feature-simplify-before-firs.md
**Conflict check:** skipped (Tier S)

## Summary

Add a routing floor to BUILD: after task resolution and the uncommitted-work floor, the `build`
completion predicate requires a CLEAN whole-feature simplify record, once per feature or stacked child.
The retries-exhausted escape honors the same floor, the retry hint steers the builder, the
no-task-progress stall breaker exempts the miss, and the `simplify`/`tdd` skills describe the pass.
Five tasks.

## Technical Approach

- **Module (`src/conductor/src/engine/feature-simplify.ts`, new, no I/O).** Exports
  `FEATURE_SIMPLIFY_REQUIRED_PREFIX = 'whole-feature simplify pass required:'` and
  `featureSimplifyRecordPath(activeChild?: ChildId)` returning
  `.pipeline/audit-trail/feature-simplification.md` or `.pipeline/audit-trail/child-<k>-simplification.md`.
  `artifacts.ts` (already a filesystem boundary) exports `featureSimplifyMissingReason(root, activeChild?)` returning `null` when the record contains a line
  matching `/^## Verdict: CLEAN\b/m`, or when `pipelinePathFor(root, 'build-review.json', activeChild)`
  exists (a feature or child already past its first completion); otherwise the reason
  `whole-feature simplify pass required: run the simplify workflow in whole-feature mode over base...HEAD and record <path> ending "## Verdict: CLEAN"`.
  Unreadable files read as absent.
- **Predicate (`artifacts.ts`, `CUSTOM_COMPLETION_PREDICATES.build`).** In the plan-backed branch, after
  `dirtyWorktreeCompletionOrNull` and before `unverifiedDoneWhenNudgeCompletion`, return
  `{ done: false, reason }` when `featureSimplifyMissingReason(dir, ctx.activeChild)` is non-null. The
  legacy no-plan branch is unchanged. Existing build-predicate and conductor fixtures that expect BUILD to
  complete gain a CLEAN feature record (a shared test helper writes it).
- **Escape (`conductor.ts`, the `anyAttemptMovedHead` exhaustion branch).** Add the conjunct
  `(await featureSimplifyMissingReason(this.projectRoot, this.activeRegionChild)) === null` beside the
  existing `uncommittedPathsOrNull(...) === null`; when it fails the branch falls through to the existing
  `!succeeded` HALT path. That path's reason chain names the simplify miss (the last completion error
  when it carries the prefix) right after the uncommitted-paths reason, as D4 does for dirty paths.
- **Hint (`remediation-hints.ts`, `buildRetryHint`, `step === 'build'`).** A reason starting with the
  prefix returns the completion-miss sentence plus: run the `simplify` workflow in whole-feature mode over
  the whole feature diff (`base...HEAD`), fix every must-fix finding, write the named record ending
  `## Verdict: CLEAN`, then complete BUILD.
- **Stall breaker (`build-progress-watcher.ts`, `isNoTaskProgressBuildStall`).** Add the prefix to the
  exempt reasons.
- **Skills.** `skills/simplify/SKILL.md` gains a "Whole-feature mode" section (scope `base...HEAD`, all
  categories, every kind and non-finding clause taken from the `build-review-implementation-quality`
  skill's Judgement section, output to the feature or child record) and §7 references that skill's
  Judgement section instead of restating the kinds. `skills/tdd/SKILL.md` and `skills/pipeline/SKILL.md`
  state that BUILD cannot complete until the whole-feature pass records CLEAN.

## Prerequisites

- None.

## Tasks

### Task 1: The build predicate requires a CLEAN whole-feature simplify record
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/feature-simplify.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `src/conductor/src/engine/feature-simplify.ts` and the predicate call as in Technical Approach; seed a CLEAN feature record (shared `test/fixtures/feature-simplify-record.ts` helper) in the existing fixtures whose subject is another gate but which expect BUILD to complete.
4. Verify GREEN.
5. Commit: "feat(build): require a CLEAN whole-feature simplify record before build_review".

**Done when:**
- [test] `checkStepCompletion('build')` returns `done: true` for a resolved build whose feature record contains `## Verdict: CLEAN`.
- [test] `checkStepCompletion('build')` returns `done: false` with a reason starting `whole-feature simplify pass required:` and naming `.pipeline/audit-trail/feature-simplification.md` for a resolved build with no record and no `.pipeline/build-review.json`, and for one whose record ends `## Verdict: SIMPLIFY_REQUIRED`.
- [test] With `activeChild: 2` and resolved child tasks, `checkStepCompletion('build')` returns `done: true` with a CLEAN `.pipeline/audit-trail/child-2-simplification.md` and returns `done: false` naming that path without it.
- [test] `checkStepCompletion('build')` returns `done: true` for a resolved build with no feature record when `.pipeline/build-review.json` exists, and for a resolved build with a CLEAN record and an existing `.pipeline/build-review.json`.

**Files likely touched:**
- `src/conductor/src/engine/feature-simplify.ts` — prefix and record path
- `src/conductor/src/engine/artifacts.ts` — `featureSimplifyMissingReason` and the predicate call
- `src/conductor/test/engine/feature-simplify.test.ts` — module tests
- `src/conductor/test/fixtures/feature-simplify-record.ts` — shared fixture seeding
- existing build-completion fixtures (artifacts, task-seed, build-child-scope, conductor, gate-loop, rebase-loop, acceptance) — seed the record

**Dependencies:** none

### Task 2: Earlier build misses keep their own reasons
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/feature-simplify.test.ts` for every Done-when check below.
2. Prove each can fail by temporarily moving the simplify check ahead of task resolution; observe RED and restore.
3. Implement: no production change beyond Task 1 is expected.
4. Verify GREEN.
5. Commit: "test(build): unresolved tasks and uncommitted paths outrank the simplify floor".

**Done when:**
- [test] `checkStepCompletion('build')` with an unresolved plan task and no feature record returns `done: false` with a reason naming that task id and not containing `whole-feature simplify`.
- [test] `checkStepCompletion('build')` with a `worktreeStatus` probe reporting an uncommitted path and no feature record returns `missing: 'uncommitted'` with a reason not containing `whole-feature simplify`.

**Files likely touched:**
- `src/conductor/test/engine/feature-simplify.test.ts` — ordering tests

**Dependencies:** Task 1

### Task 3: The exhaustion escape honors the simplify floor
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-build-escape-simplify.test.ts`, modelled on the existing `anyAttemptMovedHead` escape tests, for every Done-when check below.
2. Verify RED.
3. Implement the escape conjunct in `src/conductor/src/engine/conductor.ts` as in Technical Approach.
4. Verify GREEN.
5. Commit: "feat(conductor): the exhaustion escape refuses to route without a CLEAN simplify record".

**Done when:**
- [test] Through `Conductor.run()` with every build attempt committing, a clean tree, resolved tasks, and no feature record, the escape does not route: `build_review` is never dispatched and `.pipeline/HALT` contains `whole-feature simplify pass required:`.
- [test] Through `Conductor.run()` with every build attempt committing, a clean tree, an unresolved task, and a CLEAN feature record, the escape routes forward and `build_review` is dispatched.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — escape conjunct
- `src/conductor/test/engine/conductor-build-escape-simplify.test.ts` — escape tests

**Dependencies:** Task 1

### Task 4: The simplify miss is steered and exempt from the stall breaker
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/feature-simplify.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the hint branch and the stall exemption as in Technical Approach, using `FEATURE_SIMPLIFY_REQUIRED_PREFIX`.
4. Verify GREEN.
5. Commit: "feat(build): steer the simplify miss and exempt it from the no-progress stall".

**Done when:**
- [test] `buildRetryHint('build', <simplify reason>)` returns text naming the `simplify` workflow, whole-feature mode, `base...HEAD`, the record path from the reason, and `## Verdict: CLEAN`.
- [test] `isNoTaskProgressBuildStall` returns `false` for attempt 2, no HEAD movement, unchanged resolved count, and a reason starting `whole-feature simplify pass required:`.
- [test] `isNoTaskProgressBuildStall` returns `true` for the same counts with a reason `1/3 tasks pending/not completed: 2`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-hints.ts` — hint branch
- `src/conductor/src/engine/build-progress-watcher.ts` — exemption
- `src/conductor/test/engine/feature-simplify.test.ts` — hint and stall tests

**Dependencies:** Task 1

### Task 5: The simplify and tdd skills describe the required whole-feature pass
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Add the "Whole-feature mode" section to `skills/simplify/SKILL.md` and replace §7's kind table with a reference to the `build-review-implementation-quality` Judgement section.
2. Add the required-pass rule to `skills/tdd/SKILL.md` (refactoring section) and `skills/pipeline/SKILL.md` (end of build).
3. Run `test/test_harness_integrity.sh` skill-contract checks.
4. Commit: "skills: require the whole-feature simplify pass before BUILD completes".

**Done when:**
- `skills/simplify/SKILL.md` has a `Whole-feature mode` section that scopes analysis to `base...HEAD`, names `.pipeline/audit-trail/feature-simplification.md` and `child-<k>-simplification.md`, and directs applying every kind and non-finding clause from the `build-review-implementation-quality` skill's Judgement section.
- `skills/tdd/SKILL.md` and `skills/pipeline/SKILL.md` each state that BUILD does not complete until the whole-feature simplify record ends `## Verdict: CLEAN`.

**Files likely touched:**
- `skills/simplify/SKILL.md` — whole-feature mode, shared kinds
- `skills/tdd/SKILL.md` — required pass
- `skills/pipeline/SKILL.md` — required pass

**Dependencies:** none

## Integration Points

- After Task 1: a daemon BUILD that resolves every task without a CLEAN record retries BUILD with the simplify reason instead of dispatching `build_review`.
- After Task 3: an exhausted BUILD without the record halts naming the pass.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a resolved build with a CLEAN feature record, when the build completion check runs, then it reports done. | 1 | "returns `done: true` for a resolved build whose feature record contains `## Verdict: CLEAN`" | diff-local |
| Story 1 happy: Given a resolved build with no feature record and no `.pipeline/build-review.json`, when the build completion check runs, then it reports not done with a reason that starts `whole-feature simplify pass required:` and names `.pipeline/audit-trail/feature-simplification.md`. | 1 | "returns `done: false` with a reason starting `whole-feature simplify pass required:` and naming `.pipeline/audit-trail/feature-simplification.md` for a resolved build with no record and no `.pipeline/build-review.json`" | diff-local |
| Story 1 happy: Given an active stacked child 2 whose scoped tasks are resolved and whose child record is CLEAN, when the build completion check runs, then it reports done; without that child record it reports not done naming `.pipeline/audit-trail/child-2-simplification.md`. | 1 | "returns `done: true` with a CLEAN `.pipeline/audit-trail/child-2-simplification.md` and returns `done: false` naming that path without it" | diff-local |
| Story 1 happy: Given a resolved build whose feature record is CLEAN and whose `.pipeline/build-review.json` exists from an earlier lap, when BUILD completes again after a remediation kickback, then the check reports done without a new simplify pass. | 1 | "for a resolved build with a CLEAN record and an existing `.pipeline/build-review.json`" | diff-local |
| Story 1 negative: Given a resolved build whose feature record ends `## Verdict: SIMPLIFY_REQUIRED`, when the build completion check runs, then it reports not done with the `whole-feature simplify pass required:` reason. | 1 | "and for one whose record ends `## Verdict: SIMPLIFY_REQUIRED`" | diff-local |
| Story 1 negative: Given a resolved build with no feature record but an existing `.pipeline/build-review.json` written before this rule, when the build completion check runs, then it reports done. | 1 | "returns `done: true` for a resolved build with no feature record when `.pipeline/build-review.json` exists" | diff-local |
| Story 1 negative: Given a build with an unresolved plan task and no feature record, when the build completion check runs, then the reason names the unresolved task and does not mention the simplify pass. | 2 | "returns `done: false` with a reason naming that task id and not containing `whole-feature simplify`" | diff-local |
| Story 1 negative: Given a build with uncommitted paths and no feature record, when the build completion check runs, then the reason names the uncommitted paths and does not mention the simplify pass. | 2 | "returns `missing: 'uncommitted'` with a reason not containing `whole-feature simplify`" | diff-local |
| Story 2 happy: Given a BUILD whose attempts moved HEAD, whose tree is clean, and whose feature record is CLEAN, when its retry budget is exhausted with plan tasks still unresolved, then the run routes forward and dispatches `build_review`. | 3 | "the escape routes forward and `build_review` is dispatched" | diff-local |
| Story 2 negative: Given a BUILD whose attempts moved HEAD, whose tree is clean, whose plan tasks are resolved, and which has no feature record, when its retry budget is exhausted, then `build_review` is not dispatched and `.pipeline/HALT` is written with a reason containing `whole-feature simplify pass required:`. | 3 | "`build_review` is never dispatched and `.pipeline/HALT` contains `whole-feature simplify pass required:`" | diff-local |
| Story 3 happy: Given a build completion miss whose reason starts `whole-feature simplify pass required:`, when the retry hint is built, then it directs the builder to run the `simplify` workflow in whole-feature mode over `base...HEAD` and record the named file ending `## Verdict: CLEAN`. | 4 | "returns text naming the `simplify` workflow, whole-feature mode, `base...HEAD`, the record path from the reason, and `## Verdict: CLEAN`" | diff-local |
| Story 3 happy: Given attempt 2 or later that moved no HEAD and resolved no new task, when its completion reason starts `whole-feature simplify pass required:`, then the attempt is not classified as a no-task-progress stall. | 4 | "`isNoTaskProgressBuildStall` returns `false` for attempt 2, no HEAD movement, unchanged resolved count, and a reason starting `whole-feature simplify pass required:`" | diff-local |
| Story 3 negative: Given attempt 2 or later that moved no HEAD and resolved no new task, when its completion reason names pending tasks, then the attempt is still classified as a no-task-progress stall. | 4 | "`isNoTaskProgressBuildStall` returns `true` for the same counts with a reason `1/3 tasks pending/not completed: 2`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D1 | existing | none | The new conjunct only withholds the handoff; `build_review` and `prd_audit` keep completion authority. |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D2 | existing | none | The dirty-tree conjunct at the exhaustion escape is unchanged; D9 adds its sibling. |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D3 | no-change | none | The porcelain probe's fail-open on absence and on throw is untouched. |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D4 | no-change | none | The dirty-tree HALT reason format is untouched. |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D5 | no-change | none | Untracked-path blocking is untouched; the record lives under gitignored `.pipeline/`. |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D6 | no-change | none | Both floors stay scoped to `build`. |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D7 | no-change | none | Full-suite evidence labels are untouched. |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D8 | no-change | none | No stale-prerequisite claim is added. |
| adr-2026-08-03-uncommitted-work-floor-under-build-completion#D9 | task | task-1, task-3, task-4, task-5 | the escape does not route: `build_review` is never dispatched and `.pipeline/HALT` contains `whole-feature simplify pass required:` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
