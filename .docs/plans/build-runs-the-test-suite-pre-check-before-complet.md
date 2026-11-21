# Implementation Plan: BUILD runs the configured test_suite pre-check before completing

**Date:** 2026-11-21
**Design:** none (technical track); decision recorded in `.docs/decisions/adr-2026-08-01-engine-owned-scoped-test-invocation.md` (D11, appended 2026-11-21)
**Stories:** .docs/stories/build-runs-the-test-suite-pre-check-before-complet.md
**Conflict check:** skipped (Tier S)

## Summary

Add an optional `test_suite.pre_check` command list. BUILD runs it as its last completion floor and at
the retries-exhausted escape; a failure returns its output to the builder through the retry hint, is
exempt from the no-task-progress stall breaker, and names itself in an exhaustion HALT. A PASS is held
per HEAD. This repository sets it to format:check plus both typechecks. Six tasks.

## Technical Approach

- **Config (`src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`).**
  `TestSuiteConfig` gains `pre_check?: TestSuiteCommandConfig[]`. `pre_check` joins the `test_suite`
  allowed keys and `test_suite.pre_check[]` uses `TEST_SUITE_COMMAND_ENTRY_KEYS`. The existing
  `commands` entry validation moves into a helper `validateTestSuiteCommandEntries(raw, field,
  projectRoot)` that both `commands` and `pre_check` call; `pre_check` must be a non-empty array
  (`test_suite.pre_check must be a non-empty array`) and entry errors name `test_suite.pre_check[<i>]`.
- **Module (`src/conductor/src/engine/build-pre-check.ts`, new).** Exports
  `BUILD_PRE_CHECK_FAILED_PREFIX = 'test_suite pre-check failed:'` and
  `runBuildPreCheck(projectRoot, testSuite, runner?)`, which returns `null` when `pre_check` is unset or
  every entry exits zero, and otherwise the reason
  `test_suite pre-check failed: <command> (<working directory>) <termination reason>; output tail:` plus
  the last 40 lines of the failing entry's combined stdout and stderr. It runs the entries through
  `executeFullSuite` with `{ commands: pre_check, working_directory, timeout_seconds }` from the same
  `test_suite` block, writing no evidence.
- **Probe (`artifacts.ts` `CompletionContext`, `conductor.ts`).** `CompletionContext` gains
  `buildPreCheck?: () => Promise<string | null>`. The conductor's private `buildPreCheckMissReason()`
  reads HEAD with `currentCommitSha`, returns `null` when a PASS is held for that HEAD, and otherwise
  runs `runBuildPreCheck`, holding the HEAD on PASS in a private field. `completionCtx` passes it as
  `buildPreCheck`. An absent probe skips the floor.
- **Predicate (`artifacts.ts`, `CUSTOM_COMPLETION_PREDICATES.build`, plan-backed branch).** After every
  other floor and the unverified Done-when nudge, return `{ done: false, reason }` when
  `ctx.buildPreCheck` yields a reason. The legacy no-plan branch is unchanged.
- **Escape (`conductor.ts`).** The `anyAttemptMovedHead` exhaustion branch adds the conjunct
  `(await this.buildPreCheckMissReason()) === null`. The auto-mode exhaustion HALT chain adds
  `buildPreCheckHaltReason` (step `build` and `lastError` contains the prefix gives `lastError`) right
  after `uncommittedPathsReason`; when the escape refuses with a fresh miss, that miss becomes `lastError`.
- **Hint (`remediation-hints.ts`) and stall breaker (`build-progress-watcher.ts`).** A build reason
  starting with the prefix returns the completion-miss sentence plus: fix the failure shown, commit,
  and complete BUILD; do not run the aggregate suite, `test_suite` owns it. `isNoTaskProgressBuildStall`
  exempts the prefix.
- **This repository.** `.ai-conductor/config.yml` sets `test_suite.pre_check` to the format:check,
  typecheck, and typecheck:test command in `src/conductor`. `HARNESS.md` states that a configured
  pre-check is a bounded BUILD completion check, not aggregate proof; `skills/tdd/SKILL.md` cites it.

## Prerequisites

- None.

## Tasks

### Task 1: The pre-check configuration is validated
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config-test-suite-pre-check.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the type, allowed keys, and shared entry validation in `src/conductor/src/types/config.ts` and `src/conductor/src/engine/config.ts`.
4. Verify GREEN, including existing `test_suite.commands` validation tests.
5. Commit: "feat(config): validate test_suite.pre_check".

**Done when:**
- [test] `validateConfig` accepts a `test_suite.pre_check` list of two entries with non-empty `command` and returns the list unchanged.
- [test] `validateConfig` returns a `validation_error` whose message is `test_suite.pre_check must be a non-empty array` for `pre_check: []`.
- [test] `validateConfig` returns a `validation_error` whose message contains `test_suite.pre_check[0]` for an entry with an empty `command` and for an entry with an unknown key.

**Files likely touched:**
- `src/conductor/src/types/config.ts` — `pre_check` field
- `src/conductor/src/engine/config.ts` — allowed keys, shared entry validation
- `src/conductor/test/engine/config-test-suite-pre-check.test.ts` — validation tests

**Dependencies:** none

### Task 2: A failing pre-check withholds BUILD completion with its output
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-pre-check.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `src/conductor/src/engine/build-pre-check.ts`, the `buildPreCheck` context field and predicate call in `artifacts.ts`, and `buildPreCheckMissReason` with its `completionCtx` wiring in `conductor.ts`.
4. Verify GREEN.
5. Commit: "feat(build): run the configured test_suite pre-check before BUILD completes".

**Done when:**
- [test] `runBuildPreCheck` returns `null` for a `pre_check` whose commands all exit zero, and `checkStepCompletion('build')` with that probe returns `done: true` for a resolved build.
- [test] `runBuildPreCheck` returns a reason starting `test_suite pre-check failed:` that contains the second command and the last line it printed when that command exits non-zero, and `checkStepCompletion('build')` returns that reason with `done: false`.
- [test] The conductor's `buildPreCheckMissReason` runs a counting pre-check once across two calls at the same HEAD and returns `null` both times.

**Files likely touched:**
- `src/conductor/src/engine/build-pre-check.ts` — runner and reason
- `src/conductor/src/engine/artifacts.ts` — context field and predicate call
- `src/conductor/src/engine/conductor.ts` — probe, HEAD-held PASS
- `src/conductor/test/engine/build-pre-check.test.ts` — module, predicate, and probe tests

**Dependencies:** Task 1

### Task 3: The pre-check runs only when it is configured and BUILD is otherwise complete
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write tests in `src/conductor/test/engine/build-pre-check.test.ts` for every Done-when check below.
2. Prove each can fail by temporarily moving the probe call ahead of task resolution or dropping the HEAD comparison; observe RED and restore.
3. Implement: no production change beyond Task 2 is expected.
4. Verify GREEN.
5. Commit: "test(build): the pre-check is skipped when unconfigured or BUILD is incomplete".

**Done when:**
- [test] `runBuildPreCheck` returns `null` without running any command when `test_suite.pre_check` is unset, and `checkStepCompletion('build')` without a `buildPreCheck` probe returns `done: true` for a resolved build.
- [test] `checkStepCompletion('build')` with an unresolved plan task returns a reason naming that task and never calls the `buildPreCheck` probe.
- [test] `checkStepCompletion('build')` with a `worktreeStatus` probe reporting an uncommitted path returns `missing: 'uncommitted'` and never calls the `buildPreCheck` probe.
- [test] After a PASS at one HEAD, the conductor's `buildPreCheckMissReason` runs the pre-check again once HEAD moves to a new commit.

**Files likely touched:**
- `src/conductor/test/engine/build-pre-check.test.ts` — ordering, unconfigured, and new-HEAD tests

**Dependencies:** Task 2

### Task 4: The exhaustion escape honors the pre-check
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-build-escape-pre-check.test.ts`, modelled on the existing `anyAttemptMovedHead` escape tests, for every Done-when check below.
2. Verify RED.
3. Implement the escape conjunct and the HALT reason entry in `src/conductor/src/engine/conductor.ts`.
4. Verify GREEN.
5. Commit: "feat(conductor): the exhaustion escape refuses to route while the pre-check fails".

**Done when:**
- [test] Through `Conductor.run()` with every build attempt committing, a clean tree, and a `test_suite.pre_check` that exits non-zero, `build_review` is never dispatched and `.pipeline/HALT` contains `test_suite pre-check failed:`.
- [test] Through `Conductor.run()` with every build attempt committing, a clean tree, an unresolved task, and a `test_suite.pre_check` that exits zero, the escape routes forward and `build_review` is dispatched.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — escape conjunct, HALT reason
- `src/conductor/test/engine/conductor-build-escape-pre-check.test.ts` — escape tests

**Dependencies:** Task 2

### Task 5: The pre-check miss is steered and exempt from the stall breaker
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-pre-check.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement the hint branch and the stall exemption, using `BUILD_PRE_CHECK_FAILED_PREFIX`.
4. Verify GREEN.
5. Commit: "feat(build): steer the pre-check miss and exempt it from the no-progress stall".

**Done when:**
- [test] `buildRetryHint('build', <pre-check reason>)` returns text containing the reason's output line, `fix`, `commit`, and a statement that `test_suite` owns the aggregate suite.
- [test] `isNoTaskProgressBuildStall` returns `false` for attempt 2, no HEAD movement, unchanged resolved count, and a reason starting `test_suite pre-check failed:`.
- [test] `isNoTaskProgressBuildStall` returns `true` for the same counts with a reason `1/3 tasks pending/not completed: 2`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-hints.ts` — hint branch
- `src/conductor/src/engine/build-progress-watcher.ts` — exemption
- `src/conductor/test/engine/build-pre-check.test.ts` — hint and stall tests

**Dependencies:** Task 2

### Task 6: This repository runs its static checks as the BUILD pre-check
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Set `test_suite.pre_check` in `.ai-conductor/config.yml` to `npm run format:check --silent && npm run typecheck --silent && npm run typecheck:test --silent` in `src/conductor`.
2. State in `HARNESS.md` (intermediate test execution policy) that a configured `test_suite.pre_check` is a bounded BUILD completion check run by the engine, not aggregate proof, and cite it in `skills/tdd/SKILL.md`.
3. Document the key in the configuration reference.
4. Load the repository config through `ai-conductor` and run the harness integrity suite.
5. Commit: "chore(config): run format and typechecks as the BUILD pre-check".

**Done when:**
- `.ai-conductor/config.yml` sets `test_suite.pre_check` to one entry whose command is the format:check, typecheck, and typecheck:test chain with `working_directory: src/conductor`, and the repository config loads without a validation error.
- `HARNESS.md` and `skills/tdd/SKILL.md` each state that the configured pre-check runs before BUILD completes and is not the aggregate suite.

**Files likely touched:**
- `.ai-conductor/config.yml` — `pre_check`
- `HARNESS.md` — ownership wording
- `skills/tdd/SKILL.md` — cite the pre-check
- `docs/reference/configuration.md` — key reference

**Dependencies:** Task 1

## Integration Points

- After Task 2: a daemon BUILD whose static checks fail retries BUILD with the failure output instead of dispatching `build_review`.
- After Task 4: an exhausted BUILD with a failing pre-check halts naming it.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a resolved build and a pre-check whose commands all exit zero, when the build completion check runs, then it reports done. | 2 | "returns `done: true` for a resolved build" | diff-local |
| Story 1 happy: Given a resolved build and a pre-check whose second command exits non-zero, when the build completion check runs, then it reports not done with a reason that starts `test_suite pre-check failed:` and contains that command and the last lines of its output. | 2 | "returns a reason starting `test_suite pre-check failed:` that contains the second command and the last line it printed when that command exits non-zero" | diff-local |
| Story 1 happy: Given a resolved build whose pre-check passed at the current HEAD, when the build completion check runs again at the same HEAD, then it reports done without running the pre-check again. | 2 | "runs a counting pre-check once across two calls at the same HEAD and returns `null` both times" | diff-local |
| Story 1 negative: Given a resolved build and no `test_suite.pre_check` configured, when the build completion check runs, then it reports done and no pre-check command runs. | 3 | "returns `null` without running any command when `test_suite.pre_check` is unset" | diff-local |
| Story 1 negative: Given a build with an unresolved plan task and a configured pre-check, when the build completion check runs, then the reason names the unresolved task and no pre-check command runs. | 3 | "returns a reason naming that task and never calls the `buildPreCheck` probe" | diff-local |
| Story 1 negative: Given a build with uncommitted paths and a configured pre-check, when the build completion check runs, then the reason names the uncommitted paths and no pre-check command runs. | 3 | "returns `missing: 'uncommitted'` and never calls the `buildPreCheck` probe" | diff-local |
| Story 1 negative: Given a pre-check that passed at one HEAD, when HEAD moves to a new commit and the build completion check runs, then the pre-check runs again at the new HEAD. | 3 | "runs the pre-check again once HEAD moves to a new commit" | diff-local |
| Story 2 happy: Given a BUILD whose attempts moved HEAD, whose tree is clean, and whose configured pre-check passes, when its retry budget is exhausted with plan tasks still unresolved, then the run routes forward and dispatches `build_review`. | 4 | "the escape routes forward and `build_review` is dispatched" | diff-local |
| Story 2 negative: Given a BUILD whose attempts moved HEAD, whose tree is clean, and whose configured pre-check fails, when its retry budget is exhausted, then `build_review` is not dispatched and `.pipeline/HALT` is written with a reason containing `test_suite pre-check failed:`. | 4 | "`build_review` is never dispatched and `.pipeline/HALT` contains `test_suite pre-check failed:`" | diff-local |
| Story 3 happy: Given a build completion miss whose reason starts `test_suite pre-check failed:`, when the retry hint is built, then it carries that reason's output and directs the builder to fix the failure, commit, and complete BUILD without running the aggregate suite. | 5 | "returns text containing the reason's output line, `fix`, `commit`, and a statement that `test_suite` owns the aggregate suite" | diff-local |
| Story 3 happy: Given attempt 2 or later that moved no HEAD and resolved no new task, when its completion reason starts `test_suite pre-check failed:`, then the attempt is not classified as a no-task-progress stall. | 5 | "`isNoTaskProgressBuildStall` returns `false` for attempt 2, no HEAD movement, unchanged resolved count, and a reason starting `test_suite pre-check failed:`" | diff-local |
| Story 3 negative: Given attempt 2 or later that moved no HEAD and resolved no new task, when its completion reason names pending tasks, then the attempt is still classified as a no-task-progress stall. | 5 | "`isNoTaskProgressBuildStall` returns `true` for the same counts with a reason `1/3 tasks pending/not completed: 2`" | diff-local |
| Story 4 happy: Given `test_suite.pre_check` is a list of entries each with a non-empty `command`, when the config loads, then it loads with that list unchanged. | 1 | "accepts a `test_suite.pre_check` list of two entries with non-empty `command` and returns the list unchanged" | diff-local |
| Story 4 negative: Given `test_suite.pre_check` is an empty list, when the config loads, then it fails with `test_suite.pre_check must be a non-empty array`. | 1 | "whose message is `test_suite.pre_check must be a non-empty array` for `pre_check: []`" | diff-local |
| Story 4 negative: Given a `test_suite.pre_check` entry whose `command` is empty or which carries an unknown key, when the config loads, then it fails naming `test_suite.pre_check[<index>]`. | 1 | "whose message contains `test_suite.pre_check[0]` for an entry with an empty `command` and for an entry with an unknown key" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D1 | no-change | none | Scoped argv assembly is untouched; the pre-check takes no selectors. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D2 | no-change | none | `scoped_command` and its `{selectors}` placeholder are untouched. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D3 | existing | none | The new key is validated fail-closed in the same `test_suite` validator, and absence invalidates no existing config. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D4 | no-change | none | Empty-selection refusal is untouched. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D5 | no-change | none | Selector delivery is untouched. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D6 | no-change | none | The scoped-unavailable path is untouched. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D7 | no-change | none | Broad fallback still routes to the shared verifier; the pre-check never routes to or replaces it. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D8 | existing | none | `test_suite.command` and the aggregate verifier's fingerprint, evidence, and reuse are untouched; the pre-check writes no evidence. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D9 | no-change | none | No repository script changes. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D10 | no-change | none | Call sites keep naming the scoped interface. |
| adr-2026-08-01-engine-owned-scoped-test-invocation#D11 | task | task-1, task-2, task-4, task-5, task-6 | `build_review` is never dispatched and `.pipeline/HALT` contains `test_suite pre-check failed:` |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
