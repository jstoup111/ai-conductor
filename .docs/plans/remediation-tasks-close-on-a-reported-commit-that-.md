# Implementation Plan: Completed remediation tasks are judged against their named change before BUILD hands off

**Date:** 2026-10-23
**Stories:** .docs/stories/remediation-tasks-close-on-a-reported-commit-that-.md
**Conflict check:** Clean as of 2026-10-23 (.docs/conflicts/2026-10-21-remediation-tasks-close-on-a-reported-commit-that-.md)

## Summary

Close the #3190 gap. When a BUILD session ends, after the #3200 citation judgement and before the
completion predicate, the conductor sends every newly closed engine-appended `rem-*` task to one
schema-constrained, read-only judgement under the `build_review` provider policy:
- `resolved` stands until the task closes again.
- `persists` or `partial` reopens the task through a settled `remediation-closure` repair obligation,
  at most twice per task and only while a BUILD attempt remains.
- A judgement that cannot run records the candidates `unjudged` and never blocks.

14 tasks. Source: jstoup111/ai-conductor#3190.

## Technical Approach

**Verdict state (D11).**
- A new module, `src/conductor/src/engine/remediation-closure-state.ts`, owns one additive top-level
  `remediationClosure` section of `engine-state.json`, `{ version: 1, plans: { [planIdentity]: { tasks:
  { [taskId]: { reopenCount, verdicts: { [closeIdentity]: { verdict, rationale, disposition, applied } } } } } } }`.
- Every write goes through `createEngineStateStore(...).update`, so sibling sections stay intact.
- An absent section reads as an empty record. A present section with an unknown version or a field
  outside its closed shape reads as a failure whose message names the malformed remediation-closure
  verdict record.

**Candidates and close identity (D2).**
- A new pure module, `src/conductor/src/engine/remediation-closure-judgement.ts`, owns candidate
  selection, the close identity, the input projection, the native schema and output validation.
- The close identity is a SHA-256 digest of the task id, its reopen count, and the ordered
  `(check, evidence)` pairs of its Done-when close records. It never reads `source`, `commit`,
  `startHead` or trailers.
- A candidate satisfies all of the following:
  - it passes `isEngineAppendedRemediationTaskId`;
  - it is in the execution child's scope: `resolveChildTaskScope(projectRoot, activeChild)` when
    `completionCtx(state).activeChild` is set, otherwise every plan task id;
  - `resolveTaskIdsWithDiagnostics` counts it resolved;
  - its row carries at least one Done-when close record. This excludes `restored_from: 'task-trailer'`
    rows, which carry none.
- A candidate must also have none of the following:
  - a `pending-judgement` record;
  - an open `done-when-citation` obligation;
  - a verdict of any value for its current close identity.

**Input (D3).**
- Per candidate, the input carries:
  - the plan block from `parsePlanTaskBodies`;
  - each check's close-record source;
  - the cited commits.
- Cited commits are:
  - every 7–40 hex token in its Done-when evidence that resolves through
    `git rev-parse --verify <token>^{commit}`;
  - its `Task:` trailer commits from `listCommitsWithTrailers` over the feature evidence range. These
    are context only and never feed resolution or provenance.
- The combined `git show --format=` diff is cut at 48,000 bytes with a `truncated` flag.
- One fixed instruction string states that an `unverified` close is not by itself grounds for
  `persists` or `partial`.

**Dispatch (D4–D7, A6 approved 2026-10-23).**
- `DefaultStepRunner.dispatchRemediationClosureJudgement(input)` is declared optional in
  `step-runner-types.ts` beside `dispatchDoneWhenCitationJudgement`.
- It builds a `ResolvedBuildReviewRubricPolicy` the way `dispatchRebaseRegradeJudgement` does, with
  these differences:
  - Policy source: `steps.build_review.llm_provider ?? llm_provider ?? DEFAULT_PROVIDER`, with model and
    effort from `resolvePreferredProviderNativeStepConfig({ step: 'build_review', ... })`.
  - Provider order: every selected provider in order, filtered to those whose
    `nativeSchemaCapabilityFor(provider)?.nativeOutputSchema` is true.
  - Retries: `max_retries: 1`, because the port owns its own two-attempt loop.
  - Execution path: `executeAuxiliaryProviderCandidates` inside
    `dispatchProviderWithLifecycleSupervision('build', ...)`, with `readOnlyReview: true`, `nativeSchema`,
    `interactive: false` and `cwd` set to the feature worktree, on a session branch
    `remediation-closure-judgement:judge`. It opens no `build_review` session.
- An empty filtered set, or a runner with no provider runtimes, returns `unavailable` without invoking
  anything.
- HEAD is read before and after each attempt. A difference discards that attempt.
- Each attempt's structured result passes `validateRemediationClosureOutput`.
- The port returns `{ kind: 'valid', verdicts, attempts }` or `{ kind: 'unavailable', cause, attempts }`.

**Placement (D1, D19).**
- The new pass runs in the conductor's BUILD post-session block, straight after the citation block's
  settlement, judgement and admissions and before `checkStepCompletion(..., 'build', ...)`.
- It runs whether or not `dispatchDoneWhenCitationJudgement` exists.
- The pass is skipped with no dispatch, verdict or event when `uncommittedPathsOrNull(completionCtx)`
  returns paths. That probe counts tracked modifications and untracked non-ignored paths, so the
  predicate withholds for the dirty tree as it already does.
- The reopen reason is appended after any `Done-when citation refused:` lines:
  `Remediation closure reopened: Task <id> "<title>": <rationale>`, one line per task.

**Reopen (D8, 09-06 decision 14).**
- Per non-resolved verdict under the bound, in this order:
  1. Record the verdict with `applied: false`.
  2. Admit through `createRepairObligationStore(...).admitOrReplay('remediation-closure:<closeIdentity>', ...)`
     with authority `remediation-closure`, finding id = close identity, and instruction =
     `Task <id> "<title>": <rationale>`. The baseline is HEAD, plus the current branch when a child is
     active. The obligation is marked settled.
  3. Restage through `restageExistingRemediationTaskStatuses`.
  4. Mark the verdict applied and increment `reopenCount` once, keyed by the applied flag.
- At every BUILD session end, before candidate selection, `replayRemediationClosureReopens` replays steps
  2–4 for every unapplied non-resolved verdict. A crash therefore never leaves a completed task with an
  unapplied verdict past the next predicate, and never counts one close twice.
- `repair-obligations.ts` adds `remediation-closure` to its same-authority supersession branch, beside
  `plan_amendment` and `done-when-citation`. It never supersedes across authorities.
- No ledger, lap or growth write is made.

**Bounds (D9).** A `persists` or `partial` verdict is recorded with disposition `bound-exhausted`, admits
nothing, and leaves the task completed in either case:
- the task's `reopenCount` is already 2;
- `attempt >= stepMaxRetries`.

**Failure (D6, D7).** An `unavailable` result, or a runner with no port, records every candidate
`unjudged` for its close identity and reopens nothing.

**Stall and hint (D10).**
- `isNoTaskProgressBuildStall` gains the `Remediation closure reopened:` prefix beside its two existing
  exemptions.
- The completion reason becomes the next attempt's retry hint through the existing path.
- After a restart, the existing startup recovery that emits
  `Resume admitted repair <id>: <findingId>. <instruction>` for every settled obligation with an open
  task rebuilds the hint, so the instruction carries the task id and rationale.

**Event (D11).** `remediation_closure_judged` is added to the `ConductorEvent` union in `types/events.ts`
with an `EVENT_SINKS` row `{ render: false, persist: true, audit: false, otel: false }` and an
audit-trail completeness entry `not-audited-by-design`, as `done_when_citation_judged` has. One event is
emitted per pass that had candidates, carrying `outcome`, `attempts` and per-task `{ taskId, verdict,
rationale, disposition: reopened | left-closed | bound-exhausted }`.

**Release gate.** Every change is TypeScript under `src/conductor/`. No CLI, hook, settings, skill or
symlink changes, so no waiver and no migration block is needed.

**Local patterns.**
- **BUILD-boundary judgement:** the #3200 block in `conductor.ts` and `done-when-citation-judgement.ts`.
  - Preserve: engine-built input, engine-side validation, verdict application in the module, the reason
    override after `checkStepCompletion`, and idempotent admission keyed by content.
- **Step-policy dispatch:** `dispatchRebaseRegradeJudgement` in `step-runners.ts`.
  - Preserve: the policy shape and the auxiliary executor.
  - Allowed variation: the policy step (`build_review`), the supervision step (`build`), every selected
    provider instead of the first, and the native-schema filter.
- **Exempt prefix:** `isNoTaskProgressBuildStall` in `build-progress-watcher.ts`.

Search hints: `dispatchDoneWhenCitationJudgement`, `admitCitationRefusals`, `settleCitationRefusals`,
`restageExistingRemediationTaskStatuses`, `uncommittedPathsOrNull`, `resolveChildTaskScope`,
`superseded-by-citation-refusal`, `dispatchRebaseRegradeJudgement`.

## Prerequisites

- None. #3200 (merged in #3357) supplies the citation boundary this plan extends.

## Tasks

### Task 1: Remediation-closure verdict state is an additive engine-state section
**Story:** Story 5
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in a new `remediation-closure-state.test.ts`. Cover:
   - an absent section reads as empty;
   - each malformed shape is refused by name;
   - a write leaves sibling sections untouched.
2. Verify RED.
3. Implement `readRemediationClosureState`, `recordRemediationClosureVerdicts` and
   `markRemediationClosureApplied` in the new module through `createEngineStateStore(...).update`, as
   `repair-obligations.ts` writes its section.
4. Verify GREEN and commit: "feat(remediation-closure): persist verdicts and reopen counts".

**Done when:**
- [test] `readRemediationClosureState` on an `engine-state.json` with no `remediationClosure` section returns an empty record in which every task's reopen count is 0.
- [test] `readRemediationClosureState` on a section with an unknown version, a non-integer or negative reopen count, or a verdict outside `resolved`, `persists`, `partial` and `unjudged` returns a failure whose message names the malformed remediation-closure verdict record.
- [test] `recordRemediationClosureVerdicts` writes through `createEngineStateStore(...).update` and leaves the `repairObligations` section and every other sibling field of `engine-state.json` byte-identical.

**Files:** src/conductor/src/engine/remediation-closure-state.ts; src/conductor/test/engine/remediation-closure-state.test.ts

### Task 2: The `remediation-closure` obligation supersedes only its own authority
**Story:** Story 1
**Type:** infrastructure
**Dependencies:** none

**Steps:**
1. Write failing tests in `repair-obligations.test.ts` and `task-cli.test.ts`. Cover:
   - same-authority supersession;
   - coexistence with `plan_amendment` in both admission orders;
   - one fresh close resolving both.
2. Verify RED.
3. Implement in `repair-obligations.ts`: add `remediation-closure` to the same-authority supersession
   branch with evidence kind `superseded-by-remediation-closure`. Keep the branch's existing
   `prior.source.authority !== admission.source.authority` guard so no other authority is touched.
4. Verify GREEN and commit: "feat(repair-obligations): admit remediation-closure obligations".

**Done when:**
- [test] Admitting a second `remediation-closure` obligation for task `rem-as-built-R11` supersedes the first open one with evidence kind `superseded-by-remediation-closure`, leaving exactly one live `remediation-closure` obligation for that task.
- [test] Admitting a `plan_amendment` obligation for a task with a live `remediation-closure` obligation leaves both live, and admitting a `remediation-closure` obligation for a task with a live `plan_amendment` obligation leaves both live.
- [test] With both obligations live, one `completeTaskDoneWhen` close of the task with fresh Done-when evidence resolves both obligations, and `resolveTaskIdsWithDiagnostics` then counts the task resolved.

**Files:** src/conductor/src/engine/repair-obligations.ts; src/conductor/test/engine/repair-obligations.test.ts; src/conductor/test/engine/task-cli.test.ts

### Task 3: Candidate selection and the close identity
**Story:** Story 2
**Type:** infrastructure
**Dependencies:** Task 1

**Steps:**
1. Write failing tests in a new `remediation-closure-judgement.test.ts`. Cover:
   - identity invariance and identity change;
   - each inclusion and exclusion rule listed in Technical Approach.
2. Verify RED.
3. Implement `remediationCloseIdentity` and `selectRemediationClosureCandidates({ status, scopeTaskIds,
   resolvedIds, state, openCitationTaskIds })` as pure functions in the new module.
4. Verify GREEN and commit: "feat(remediation-closure): select candidates by close identity".

**Done when:**
- [test] `remediationCloseIdentity` returns the same digest when only a record's `source`, the row's `commit`, its `startHead`, or the task's `Task:` trailers differ, and a different digest when the reopen count or a record's check text or evidence differs.
- [test] `selectRemediationClosureCandidates` returns only resolved tasks passing `isEngineAppendedRemediationTaskId` inside the supplied scope ids, and excludes a task with a `pending-judgement` record, a task with an open `done-when-citation` obligation, and a task holding a `resolved`, `persists`, `partial` or `unjudged` verdict for its current close identity.
- [test] A row with `restored_from: 'task-trailer'` and no Done-when close records is not a candidate, the same row after a close that writes fresh Done-when records is a candidate, and a reopened task resolved again with its earlier close records is a candidate because its incremented reopen count changed its close identity.

**Files:** src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/test/engine/remediation-closure-judgement.test.ts

### Task 4: The judgement input carries the plan block, sources and cited commits
**Story:** Story 3
**Type:** infrastructure
**Dependencies:** Task 3

**Steps:**
1. Write failing tests in `remediation-closure-judgement.test.ts` against a temporary git repository with
   real commits. Cover:
   - the plan-block fields;
   - a resolving evidence SHA and a trailer commit;
   - an evidence token that does not resolve;
   - the 48,000-byte cap;
   - the `unverified` instruction.
2. Verify RED.
3. Implement `buildRemediationClosureInput(projectRoot, candidates, planBodies)` and the exported
   `REMEDIATION_CLOSURE_DIFF_CAP_BYTES = 48000`. Trailer commits come from `listCommitsWithTrailers` and
   are labelled as context only.
4. Verify GREEN and commit: "feat(remediation-closure): build the bounded judgement input".

**Done when:**
- [test] For a candidate with a `Task:` trailer commit and a `reported` evidence value naming a second resolving SHA, `buildRemediationClosureInput` carries the plan block's title, Rationale, Criterion, Governing clause and Done-when checks, each check's close-record source, and both commits' diffs.
- [test] When the cited commits' combined diff exceeds 48,000 bytes the input's diff text is exactly 48,000 bytes and `truncated` is `true`, and below the cap `truncated` is `false`.
- [test] An evidence token shaped like a SHA that does not resolve to a commit is omitted from the cited commits without an error, and the input is still returned.
- [test] For a candidate whose check is closed `unverified`, the input gives that check's source as `unverified` and its instruction text states that an `unverified` close is not by itself grounds for `persists` or `partial`.

**Files:** src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/test/engine/remediation-closure-judgement.test.ts

### Task 5: The closed result schema and its validator
**Story:** Story 4
**Type:** negative-path
**Dependencies:** none

**Steps:**
1. Write failing table-driven tests in `remediation-closure-judgement.test.ts`, one row per malformed
   shape named in the Done-when checks, plus one valid result.
2. Verify RED.
3. Implement `REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA` and
   `validateRemediationClosureOutput(output, candidateIds)`, returning `{ kind: 'valid', verdicts }` or
   `{ kind: 'invalid', reason }`.
4. Verify GREEN and commit: "feat(remediation-closure): validate the closed verdict schema".

**Done when:**
- [test] `validateRemediationClosureOutput` returns an invalid result for each of: a missing candidate id, an extra non-candidate task id, a key other than `taskId`, `verdict` and `rationale`, a verdict outside `resolved`, `persists` and `partial`, and an empty rationale.
- [test] `validateRemediationClosureOutput` returns the verdicts unchanged when there is exactly one entry per candidate, each with a non-empty rationale.
- `REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA` sets `additionalProperties: false` on each entry, requires `taskId`, `verdict` and `rationale`, restricts `verdict` to `resolved`, `persists` and `partial`, and sets `minLength: 1` on `rationale`.

**Files:** src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/test/engine/remediation-closure-judgement.test.ts

### Task 6: The step runner dispatches under the `build_review` policy, supervised as BUILD
**Story:** Story 3
**Type:** infrastructure
**Dependencies:** Tasks 4, 5

**Steps:**
1. Write failing tests in a new `step-runners-remediation-closure.test.ts` with mocked provider runtimes
   and a mocked HEAD reader. Use a config where `steps.build.llm_provider` and
   `steps.build_review.llm_provider` select different providers. Cover:
   - policy source and provider order;
   - lifecycle step attribution;
   - the read-only flag, native schema and working directory;
   - the unavailable path;
   - retry once;
   - a HEAD change during an attempt.
2. Verify RED.
3. Implement `dispatchRemediationClosureJudgement` on `DefaultStepRunner` as described in Technical
   Approach.
   - Follow the `dispatchRebaseRegradeJudgement` policy construction.
   - Allowed variation: step `build_review` for the policy, step `build` for supervision, every provider,
     and the native-schema filter.
   - Declare it in `step-runner-types.ts`.
4. Verify GREEN and commit: "feat(step-runners): dispatch the remediation-closure judgement".

**Done when:**
- [test] With `steps.build_review.llm_provider` set to two schema-capable providers different from BUILD's, `dispatchRemediationClosureJudgement` makes one free-form provider call, an engine-rendered prompt with no skill invocation, under the `build_review` selection in order with the model and effort resolved for `build_review`, while its lifecycle supervision events name the `build` step and no `build_review` session is opened.
- [test] The provider call carries `readOnlyReview: true`, `nativeSchema` equal to `REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA`, and `cwd` equal to the feature worktree, and a `build_review` selection with no provider declaring `nativeSchemaCapability.nativeOutputSchema` returns `unavailable` with zero provider invocations.
- [test] A schema-invalid first result followed by a valid retry returns the retry's verdicts with `attempts: 2`, and two schema-invalid results, a thrown dispatch, or an unsuccessful provider result return `unavailable` after exactly two provider invocations.
- [test] When the HEAD read after an attempt differs from the HEAD read before it, that attempt's output is discarded and counted as a failed attempt.

**Files:** src/conductor/src/engine/step-runners.ts; src/conductor/src/engine/step-runner-types.ts; src/conductor/test/engine/step-runners-remediation-closure.test.ts

### Task 7: The conductor judges remediation candidates after the citation judgement
**Story:** Story 7
**Type:** happy-path
**Dependencies:** Tasks 3, 6

**Steps:**
1. Write failing tests in a new `conductor-remediation-closure.test.ts`. Use a stub step runner, a real
   `.pipeline/task-status.json` and a real git repository. Cover:
   - dispatch order;
   - one call covering every candidate;
   - the resolved path and no re-judgement;
   - the demoted-pending case;
   - the refused-citation exclusion;
   - an unresolvable SHA-shaped evidence token.
2. Verify RED.
3. Implement `runRemediationClosurePass` in the judgement module and call it from the conductor after
   the citation block and before `checkStepCompletion`. The pass:
   - computes candidates with `openCitationTaskIds` read from the live `done-when-citation` obligations;
   - dispatches once;
   - records `resolved` verdicts.
4. Verify GREEN and commit: "feat(conductor): judge remediation closures at the BUILD boundary".

**Done when:**
- [test] A BUILD session ending with a pending citation on task 4 and two remediation candidates makes the `dispatchDoneWhenCitationJudgement` call before exactly one `dispatchRemediationClosureJudgement` call whose input covers both candidates, and both calls precede the BUILD completion predicate.
- [test] When every candidate is judged `resolved`, BUILD completes with neither `Done-when citation refused:` nor `Remediation closure reopened:` in its reason, each verdict is recorded for its close identity, and the next session end with no new close makes no `dispatchRemediationClosureJudgement` call.
- [test] A remediation task whose `pending-judgement` record is demoted to `unverified` because the citation judgement is unavailable is in the same pass's `dispatchRemediationClosureJudgement` input, and a remediation task whose citation was refused in that pass is absent from it and has exactly one open obligation.
- [test] A candidate whose Done-when evidence carries a SHA-shaped token that does not resolve to a commit still produces exactly one `dispatchRemediationClosureJudgement` call, and that token is absent from the call's cited commits.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/test/engine/conductor-remediation-closure.test.ts

### Task 8: The pass skips dirty trees, other children, ordinary tasks and unchanged closes
**Story:** Story 2
**Type:** negative-path
**Dependencies:** Task 7

**Steps:**
1. Write failing tests in `conductor-remediation-closure.test.ts`. Cover each skip condition in the
   Done-when checks:
   - a dirty tree, from a tracked modification and from an untracked non-ignored file;
   - a two-child stacked fixture;
   - a runner without the citation port;
   - an ordinary `reported` task;
   - a file-changing rebase through `translateAfterRebase`;
   - a source rewrite by `done-when accept`;
   - a worktree recreated through task seeding from `Task:` trailers.
2. Verify RED.
3. Implement:
   - the `uncommittedPathsOrNull` guard;
   - the `resolveChildTaskScope` scope;
   - the pass's independence from the citation port's presence.
4. Verify GREEN and commit: "fix(conductor): scope the remediation-closure pass".

**Done when:**
- [test] A session end with every task resolved and either an uncommitted tracked change or an untracked non-ignored file makes no `dispatchRemediationClosureJudgement` call, records no verdict, emits no `remediation_closure_judged` event, and leaves BUILD not complete with the uncommitted-paths reason.
- [test] In a stacked feature whose execution child is child 2, a completed remediation task in child 1's scope is absent from the dispatch input, and a runner with no `dispatchDoneWhenCitationJudgement` still dispatches the remediation judgement for a candidate.
- [test] An ordinary plan task closed only with `reported` evidence is never in a `dispatchRemediationClosureJudgement` input, and with no remediation task in the plan BUILD completes on task resolution as before.
- [test] A task judged `resolved` is not sent to the judge again at the next session end after `translateAfterRebase` rewrote its row's `commit` and `startHead`, or after `done-when accept` or citation settlement rewrote a record's `source`, with no new close.
- [test] After the worktree is recreated and task seeding restores remediation tasks from `Task:` trailers with no verdict section, no restored task is sent to the judge or reopened, and a restored task later closed again with fresh Done-when evidence is sent to the judge at the next session end.

**Files:** src/conductor/src/engine/conductor.ts; src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/test/engine/conductor-remediation-closure.test.ts

### Task 9: A non-resolved verdict reopens its task through a settled obligation
**Story:** Story 1
**Type:** happy-path
**Dependencies:** Tasks 2, 7

**Steps:**
1. Write failing tests in `conductor-remediation-closure.test.ts`. Cover:
   - `persists` and `partial` reopen;
   - mixed verdicts on one commit;
   - the reason order with a citation refusal;
   - the retry hint;
   - trailer resolution after the reopen;
   - ledger and growth readings;
   - a stacked child k admission.
2. Verify RED.
3. Implement `applyRemediationClosureVerdicts` in the judgement module, using the four-step order and
   the admission described in Technical Approach. Build the reason lines and append them after the
   citation lines in the conductor's completion override.
4. Verify GREEN and commit: "feat(remediation-closure): reopen tasks whose named change is absent".

**Done when:**
- [test] A `persists` verdict for `rem-as-built-R11` with a BUILD attempt left admits one settled obligation with authority `remediation-closure`, finding id equal to its close identity and instruction naming the task id and the judge's rationale, restages the row `pending`, withholds BUILD completion with a reason starting `Remediation closure reopened:` that names `rem-as-built-R11`, its title and the rationale, and no `test_suite` dispatch follows.
- [test] A `partial` verdict produces the same admission, restage and reason as `persists`, and of three tasks closed by one commit and judged `resolved`, `resolved` and `persists`, only the `persists` task is restaged while the other two stay completed.
- [test] When the same pass refuses task 4's citation and reopens `rem-as-built-R5`, the completion reason carries the `Done-when citation refused:` line first and the `Remediation closure reopened:` line after it, and the next BUILD attempt's retry hint names `rem-as-built-R5` and the judge's rationale.
- [test] After the reopen, `resolveTaskIdsWithDiagnostics` does not resolve the task from its pre-reopen `Task:` commit but resolves it from a new `Task:` commit past the obligation boundary or a fresh Done-when close, the next session end then sends it to the judge, and the kickback ledger and `readPlanGrowthBudget` read identical before and after the reopen.
- [test] In a stacked feature with a routed repair open on child k, a `persists` verdict at child k's session end for a completed remediation task recorded to child k admits its obligation with baseline `branch` equal to child k's branch and `head` equal to that branch's tip at admission.

**Files:** src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-remediation-closure.test.ts

### Task 10: Reopens stop at two per task and at the last BUILD attempt
**Story:** Story 5
**Type:** negative-path
**Dependencies:** Tasks 9, 14

**Steps:**
1. Write failing tests in `conductor-remediation-closure.test.ts`. Cover:
   - three successive `persists` closes;
   - a `persists` verdict at `attempt >= stepMaxRetries`;
   - the reopen count increments.
2. Verify RED.
3. Implement the bound check in `applyRemediationClosureVerdicts`. It takes the persisted `reopenCount`
   and an `attemptsExhausted` flag from the conductor, and records disposition `bound-exhausted`
   without admitting.
4. Verify GREEN and commit: "feat(remediation-closure): bound reopens per task and by BUILD attempts".

**Done when:**
- [test] Three successive `persists` closes of one task reopen it after the first two and, after the third, leave it completed with no `remediation-closure` obligation admitted, the pass's `remediation_closure_judged` event names it with disposition `bound-exhausted`, and BUILD completes and hands off.
- [test] A `persists` verdict on the last BUILD attempt the step's retry cap allows admits no obligation, leaves the task completed, the pass's `remediation_closure_judged` event names it with disposition `bound-exhausted`, and BUILD completes and hands off instead of failing.
- [test] Each reopen increments the task's persisted `reopenCount` by exactly one, and a `bound-exhausted` verdict leaves it unchanged.

**Files:** src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-remediation-closure.test.ts

### Task 11: Reopen application survives a crash, a restart and a malformed record
**Story:** Story 5
**Type:** negative-path
**Dependencies:** Task 9

**Steps:**
1. Write failing tests in `conductor-remediation-closure.test.ts`. Cover:
   - a stop simulated after each of the first three write steps, followed by the next session end;
   - a malformed `remediationClosure` section;
   - a fresh conductor instance started on the reopened worktree.
2. Verify RED.
3. Implement `replayRemediationClosureReopens` and call it before candidate selection at every BUILD
   session end. When `readRemediationClosureState` fails, the conductor sets the completion to
   `done: false` with a reason naming the malformed remediation-closure verdict record, and dispatches
   nothing.
4. Verify GREEN and commit: "fix(remediation-closure): replay interrupted reopens".

**Done when:**
- [test] A stop simulated after the verdict write, after the admission, or after the restage of a `persists` application, followed by the next BUILD session end, leaves exactly one open `remediation-closure` obligation, the task row `pending`, and the reopen count incremented exactly once.
- [test] With a malformed `remediationClosure` section in `engine-state.json`, a BUILD session ending with every task resolved is not complete, its reason names the malformed remediation-closure verdict record, and no `dispatchRemediationClosureJudgement` call is made.
- [test] After a reopen, a fresh conductor started on the same worktree reads the task's reopen count unchanged, and its first BUILD attempt's retry hint contains the open obligation's instruction naming the task id and the judge's rationale.

**Files:** src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-remediation-closure.test.ts

### Task 12: A judgement that cannot run records candidates unjudged
**Story:** Story 4
**Type:** negative-path
**Dependencies:** Task 7

**Steps:**
1. Write failing tests in `conductor-remediation-closure.test.ts`. Cover:
   - an `unavailable` port result;
   - a runner without the port;
   - no re-judgement of an `unjudged` close.
2. Verify RED.
3. Implement the `unjudged` branch of `runRemediationClosurePass`.
4. Verify GREEN and commit: "feat(remediation-closure): hand off unjudged when the judge cannot run".

**Done when:**
- [test] When `dispatchRemediationClosureJudgement` returns `unavailable` after two failed attempts, every candidate is recorded `unjudged` for its current close identity, no obligation is admitted, no task is restaged, and BUILD completes when nothing else withholds it.
- [test] A step runner without `dispatchRemediationClosureJudgement` records every candidate `unjudged` and restages nothing, and a candidate recorded `unjudged` is not sent to the judge at the next session end with no new close.

**Files:** src/conductor/src/engine/remediation-closure-judgement.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/conductor-remediation-closure.test.ts

### Task 13: A reopen retry is never a no-progress stall
**Story:** Story 1
**Type:** negative-path
**Dependencies:** Task 9

**Steps:**
1. Write failing tests:
   - in `conductor-build-progress.test.ts`, for the predicate;
   - in `conductor-remediation-closure.test.ts`, for a run where attempt 1 ends in a reopen and the next
     attempt neither moves HEAD nor raises the resolved count.
2. Verify RED.
3. Implement: add the `Remediation closure reopened:` prefix to `isNoTaskProgressBuildStall`'s exemptions.
   The completion reason carries this prefix even when citation lines come first, because the citation
   prefix is already exempt.
4. Verify GREEN and commit: "fix(build-progress): exempt remediation-closure reopens from the stall breaker".

**Done when:**
- [test] `isNoTaskProgressBuildStall` returns false at attempt 2 or later when the resolved count fell, HEAD did not move, and the completion reason starts with `Remediation closure reopened:`, and still returns true for the same inputs with a reason outside the three exempt prefixes.
- [test] A conductor run whose attempt ended with a remediation-closure reopen, with the resolved count falling and HEAD unmoved, does not classify the next attempt `no_task_progress`, emits no `build_stall` event, and writes no HALT marker.

**Files:** src/conductor/src/engine/build-progress-watcher.ts; src/conductor/test/conductor-build-progress.test.ts; src/conductor/test/engine/conductor-remediation-closure.test.ts

### Task 14: One `remediation_closure_judged` event per pass
**Story:** Story 6
**Type:** infrastructure
**Dependencies:** Tasks 9, 12

**Steps:**
1. Write failing tests in `event-sinks.test.ts`, `audit-trail-completeness.integration.test.ts` and
   `conductor-remediation-closure.test.ts`. Cover:
   - a judged pass;
   - an unjudged pass;
   - a two-attempt pass;
   - no candidates;
   - the sink and audit rows.
2. Verify RED.
3. Implement:
   - add the variant to `types/events.ts`;
   - add its `EVENT_SINKS` row;
   - add its audit-trail completeness classification and fixture;
   - emit it through `emitTracked` once per pass that had candidates.
4. Verify GREEN and commit: "feat(events): record remediation-closure judgements".

**Done when:**
- [test] A pass judging `rem-as-built-R11` `persists` and `rem-as-built-R5` `resolved` persists exactly one `remediation_closure_judged` line to `.pipeline/events.jsonl` with outcome `judged`, its attempt count, and per task the id, verdict, rationale and disposition `reopened` or `left-closed`.
- [test] A pass that handed off unjudged persists one event with outcome `unjudged` in which every candidate's verdict is `unjudged`, and a pass whose port returned verdicts on its second attempt applies those verdicts and persists `attempts: 2`.
- [test] A BUILD session end with no candidates, including a plan with no `rem-*` task, persists no `remediation_closure_judged` event and makes no `dispatchRemediationClosureJudgement` call.
- [test] `EVENT_SINKS` has a `remediation_closure_judged` row with `persist: true`, and the audit-trail completeness classification lists `remediation_closure_judged`.

**Files:** src/conductor/src/types/events.ts; src/conductor/src/engine/event-sinks.ts; src/conductor/src/engine/conductor.ts; src/conductor/test/engine/event-sinks.test.ts; src/conductor/test/integration/audit-trail-completeness.integration.test.ts; src/conductor/test/engine/conductor-remediation-closure.test.ts

## Task Dependency Graph

```
1 ──► 3 ──► 4 ──► 6 ──► 7 ──► 8
            5 ──► 6
      3 ─────────────► 7 ──► 12 ──► 14
2 ──────────────────────► 9 ──► 14 ──► 10
                     7 ──► 9 ──► 11
                           9 ──► 13
```

## Integration Points

- After Task 6, the port reaches a real provider runtime under the `build_review` policy with BUILD supervision.
- After Task 7, a BUILD session end judges remediation candidates through the real conductor path, after the citation judgement.
- After Task 9, a non-resolved verdict reopens its task and withholds BUILD hand-off end to end.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given every plan task is resolved, the worktree is clean, and a completed task `rem-as-built-R11` has no verdict for its current close, when the BUILD session ends and the judge returns `persists` for it, then BUILD is not complete, its completion reason begins with `Remediation closure reopened:` and names `rem-as-built-R11` by id and title with the judge's rationale, the `rem-as-built-R11` row is `pending`, and `test_suite` is not started. | 9 | "A `persists` verdict for `rem-as-built-R11` with a BUILD attempt left admits one settled obligation with authority `remediation-closure`, finding id equal to its close identity and instruction naming the task id and the judge's rationale, restages the row `pending`, withholds BUILD completion with a reason starting `Remediation closure reopened:` that names `rem-as-built-R11`, its title and the rationale, and no `test_suite` dispatch follows." | diff-local |
| Story 1 happy: Given the judge returns `partial` for a completed remediation task, when the BUILD session ends, then that task is reopened exactly as a `persists` verdict reopens it. | 9 | "A `partial` verdict produces the same admission, restage and reason as `persists`, and of three tasks closed by one commit and judged `resolved`, `resolved` and `persists`, only the `persists` task is restaged while the other two stay completed." | diff-local |
| Story 1 happy: Given a remediation task was reopened by a `persists` verdict, when the next BUILD attempt is dispatched, then its retry hint names the task id and the judge's rationale for that task. | 9, 11 | "When the same pass refuses task 4's citation and reopens `rem-as-built-R5`, the completion reason carries the `Done-when citation refused:` line first and the `Remediation closure reopened:` line after it, and the next BUILD attempt's retry hint names `rem-as-built-R5` and the judge's rationale." | diff-local |
| Story 1 negative: Given a reopened remediation task whose only evidence is a `Task:` trailer commit from before the reopen, when BUILD resolves task progress, then the task is still unresolved. | 9 | "After the reopen, `resolveTaskIdsWithDiagnostics` does not resolve the task from its pre-reopen `Task:` commit but resolves it from a new `Task:` commit past the obligation boundary or a fresh Done-when close, the next session end then sends it to the judge, and the kickback ledger and `readPlanGrowthBudget` read identical before and after the reopen." | diff-local |
| Story 1 negative: Given a reopened remediation task, when a new commit with its `Task:` trailer lands after the reopen or the agent closes it again with fresh Done-when evidence, then the task resolves. | 9, 2 | "After the reopen, `resolveTaskIdsWithDiagnostics` does not resolve the task from its pre-reopen `Task:` commit but resolves it from a new `Task:` commit past the obligation boundary or a fresh Done-when close, the next session end then sends it to the judge, and the kickback ledger and `readPlanGrowthBudget` read identical before and after the reopen." | diff-local |
| Story 1 negative: Given a BUILD attempt ended with a closure-judgement reopen and the resolved-task count fell and HEAD did not move, when the stall detector evaluates the next attempt, then BUILD is not classified as `no_task_progress`. | 13 | "A conductor run whose attempt ended with a remediation-closure reopen, with the resolved count falling and HEAD unmoved, does not classify the next attempt `no_task_progress`, emits no `build_stall` event, and writes no HALT marker." | diff-local |
| Story 1 negative: Given a remediation task is reopened by the judgement, when the kickback ledger and plan-growth allowance are read afterwards, then no gate lap and no plan growth were charged. | 9 | "After the reopen, `resolveTaskIdsWithDiagnostics` does not resolve the task from its pre-reopen `Task:` commit but resolves it from a new `Task:` commit past the obligation boundary or a fresh Done-when close, the next session end then sends it to the judge, and the kickback ledger and `readPlanGrowthBudget` read identical before and after the reopen." | diff-local |
| Story 2 happy: Given every completed remediation task is judged `resolved`, when the BUILD session ends, then BUILD completes and hands off as it did before this change. | 7 | "When every candidate is judged `resolved`, BUILD completes with neither `Done-when citation refused:` nor `Remediation closure reopened:` in its reason, each verdict is recorded for its close identity, and the next session end with no new close makes no `dispatchRemediationClosureJudgement` call." | diff-local |
| Story 2 happy: Given one commit closes three remediation tasks and the judge returns `resolved` for two and `persists` for one, when the BUILD session ends, then only the `persists` task is reopened and the other two stay completed. | 9 | "A `partial` verdict produces the same admission, restage and reason as `persists`, and of three tasks closed by one commit and judged `resolved`, `resolved` and `persists`, only the `persists` task is restaged while the other two stay completed." | diff-local |
| Story 2 negative: Given a remediation task already has a `resolved` verdict for its current close, when the next BUILD session ends with no new close of that task, then that task is not sent to the judge again. | 7, 3 | "When every candidate is judged `resolved`, BUILD completes with neither `Done-when citation refused:` nor `Remediation closure reopened:` in its reason, each verdict is recorded for its close identity, and the next session end with no new close makes no `dispatchRemediationClosureJudgement` call." | diff-local |
| Story 2 negative: Given a plan with no engine-appended `rem-*` task, or whose remediation tasks all already have verdicts for their current closes, when the BUILD session ends, then no remediation-closure judgement is dispatched and no `remediation_closure_judged` event is emitted. | 14, 3 | "A BUILD session end with no candidates, including a plan with no `rem-*` task, persists no `remediation_closure_judged` event and makes no `dispatchRemediationClosureJudgement` call." | diff-local |
| Story 2 negative: Given a stacked feature whose remediation task belongs to a child other than the execution child, when the execution child's BUILD session ends, then that task is not judged. | 8, 3 | "In a stacked feature whose execution child is child 2, a completed remediation task in child 1's scope is absent from the dispatch input, and a runner with no `dispatchDoneWhenCitationJudgement` still dispatches the remediation judgement for a candidate." | diff-local |
| Story 2 negative: Given a stacked feature with a routed repair open on host child k, when child k's BUILD session ends with a completed remediation task recorded to child k, then that task is judged and a `persists` verdict admits its obligation with the boundary `{branch, head}` of child k's branch taken at admission. | 9 | "In a stacked feature with a routed repair open on child k, a `persists` verdict at child k's session end for a completed remediation task recorded to child k admits its obligation with baseline `branch` equal to child k's branch and `head` equal to that branch's tip at admission." | diff-local |
| Story 2 negative: Given a judged remediation task whose branch was rebased and whose Done-when close records are unchanged, when the next BUILD session ends, then that task is not sent to the judge again. | 8, 3 | "A task judged `resolved` is not sent to the judge again at the next session end after `translateAfterRebase` rewrote its row's `commit` and `startHead`, or after `done-when accept` or citation settlement rewrote a record's `source`, with no new close." | diff-local |
| Story 2 negative: Given an ordinary plan task closed only with `reported` evidence, when the BUILD session ends, then it is never sent to the remediation-closure judge and BUILD completes on task resolution as before. | 8 | "An ordinary plan task closed only with `reported` evidence is never in a `dispatchRemediationClosureJudgement` input, and with no remediation task in the plan BUILD completes on task resolution as before." | diff-local |
| Story 2 negative: Given every plan task is resolved, the worktree has an uncommitted tracked change or an untracked file that is not ignored, and a completed remediation task has no verdict for its current close, when the BUILD session ends, then no remediation-closure judgement is dispatched, no verdict is recorded, and BUILD is not complete for the dirty tree. | 8 | "A session end with every task resolved and either an uncommitted tracked change or an untracked non-ignored file makes no `dispatchRemediationClosureJudgement` call, records no verdict, emits no `remediation_closure_judged` event, and leaves BUILD not complete with the uncommitted-paths reason." | diff-local |
| Story 2 negative: Given a worktree recreated from its branch so its remediation tasks are restored from `Task:` trailers and no verdict record exists, when the BUILD session ends, then no restored remediation task without Done-when close records is sent to the judge and none is reopened, and a restored task later closed again with fresh Done-when evidence is sent to the judge for that close. | 8, 3 | "After the worktree is recreated and task seeding restores remediation tasks from `Task:` trailers with no verdict section, no restored task is sent to the judge or reopened, and a restored task later closed again with fresh Done-when evidence is sent to the judge at the next session end." | diff-local |
| Story 2 negative: Given a remediation task judged `resolved` whose check source is later rewritten by citation settlement or by `done-when accept`, when the next BUILD session ends with no new close of that task, then it is not sent to the judge again. | 8, 3 | "A task judged `resolved` is not sent to the judge again at the next session end after `translateAfterRebase` rewrote its row's `commit` and `startHead`, or after `done-when accept` or citation settlement rewrote a record's `source`, with no new close." | diff-local |
| Story 2 negative: Given a remediation task reopened by the judgement and later resolved only by a new `Task:` trailer commit past its obligation boundary, when the next BUILD session ends, then that task is sent to the judge for its new close. | 9, 3 | "After the reopen, `resolveTaskIdsWithDiagnostics` does not resolve the task from its pre-reopen `Task:` commit but resolves it from a new `Task:` commit past the obligation boundary or a fresh Done-when close, the next session end then sends it to the judge, and the kickback ledger and `readPlanGrowthBudget` read identical before and after the reopen." | diff-local |
| Story 3 happy: Given a completed remediation task with a `Task:` trailer commit and a `reported` Done-when evidence value naming another commit SHA that resolves, when the judgement input is built, then it contains the task's plan block (title, Rationale, Criterion, Governing clause and Done-when checks), each check's close-record source, and the diff of both commits. | 4 | "For a candidate with a `Task:` trailer commit and a `reported` evidence value naming a second resolving SHA, `buildRemediationClosureInput` carries the plan block's title, Rationale, Criterion, Governing clause and Done-when checks, each check's close-record source, and both commits' diffs." | diff-local |
| Story 3 happy: Given candidates exist, when the judgement is dispatched, then it is one free-form dispatch covering every candidate, it carries the native output schema and the read-only review flag, its working directory is the feature worktree, and its provider, model and effort are those resolved from the `build_review` step's configuration while the dispatch is attributed to the running BUILD step. | 6, 7 | "With `steps.build_review.llm_provider` set to two schema-capable providers different from BUILD's, `dispatchRemediationClosureJudgement` makes one free-form provider call, an engine-rendered prompt with no skill invocation, under the `build_review` selection in order with the model and effort resolved for `build_review`, while its lifecycle supervision events name the `build` step and no `build_review` session is opened." | diff-local |
| Story 3 negative: Given the cited commits' combined diff exceeds 48,000 bytes, when the judgement input is built, then the diff is cut to 48,000 bytes and the input states that it was truncated. | 4 | "When the cited commits' combined diff exceeds 48,000 bytes the input's diff text is exactly 48,000 bytes and `truncated` is `true`, and below the cap `truncated` is `false`." | diff-local |
| Story 3 negative: Given a `reported` Done-when evidence value contains text that looks like a SHA but does not resolve to a commit, when the judgement input is built, then that text is ignored and the judgement still runs. | 4, 7 | "A candidate whose Done-when evidence carries a SHA-shaped token that does not resolve to a commit still produces exactly one `dispatchRemediationClosureJudgement` call, and that token is absent from the call's cited commits." | diff-local |
| Story 3 negative: Given a candidate whose only non-resolved signal is a check closed `unverified`, when the judgement input is built, then that check's source is given as `unverified` and the input's instruction says an `unverified` close is not by itself grounds for `persists` or `partial`. | 4 | "For a candidate whose check is closed `unverified`, the input gives that check's source as `unverified` and its instruction text states that an `unverified` close is not by itself grounds for `persists` or `partial`." | diff-local |
| Story 3 negative: Given no configured provider for the `build_review` step declares native output schema support, when the judgement is dispatched, then the dispatch is unavailable and no provider is invoked. | 6 | "The provider call carries `readOnlyReview: true`, `nativeSchema` equal to `REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA`, and `cwd` equal to the feature worktree, and a `build_review` selection with no provider declaring `nativeSchemaCapability.nativeOutputSchema` returns `unavailable` with zero provider invocations." | diff-local |
| Story 3 negative: Given the feature HEAD differs when the dispatch returns from the HEAD it started at, when the result is read, then the result is discarded and handled as a failed dispatch. | 6 | "When the HEAD read after an attempt differs from the HEAD read before it, that attempt's output is discarded and counted as a failed attempt." | diff-local |
| Story 4 happy: Given the first dispatch returns output that fails the result schema and the immediate retry returns a valid result, when the BUILD session ends, then the retry's verdicts are applied and the event records two attempts. | 6, 14 | "A pass that handed off unjudged persists one event with outcome `unjudged` in which every candidate's verdict is `unjudged`, and a pass whose port returned verdicts on its second attempt applies those verdicts and persists `attempts: 2`." | diff-local |
| Story 4 negative: Given the dispatch fails the schema on both attempts, when the BUILD session ends, then no task is reopened, every candidate is recorded `unjudged` for its current close, the event records outcome `unjudged`, and BUILD completes when nothing else withholds it. | 12, 6, 14 | "When `dispatchRemediationClosureJudgement` returns `unavailable` after two failed attempts, every candidate is recorded `unjudged` for its current close identity, no obligation is admitted, no task is restaged, and BUILD completes when nothing else withholds it." | diff-local |
| Story 4 negative: Given a result that omits a candidate id, adds a task id that was not a candidate, carries a key other than `taskId`, `verdict` and `rationale`, has a verdict other than `resolved`, `persists` or `partial`, or has an empty rationale, when it is validated, then it is a failed dispatch. | 5 | "`validateRemediationClosureOutput` returns an invalid result for each of: a missing candidate id, an extra non-candidate task id, a key other than `taskId`, `verdict` and `rationale`, a verdict outside `resolved`, `persists` and `partial`, and an empty rationale." | diff-local |
| Story 4 negative: Given the provider dispatch throws or reports failure, when the BUILD session ends, then it is a failed dispatch handled by the same single retry. | 6 | "A schema-invalid first result followed by a valid retry returns the retry's verdicts with `attempts: 2`, and two schema-invalid results, a thrown dispatch, or an unsuccessful provider result return `unavailable` after exactly two provider invocations." | diff-local |
| Story 4 negative: Given a step runner with no remediation-closure dispatch port, when the BUILD session ends with candidates, then the candidates are recorded `unjudged` and no task is reopened. | 12 | "A step runner without `dispatchRemediationClosureJudgement` records every candidate `unjudged` and restages nothing, and a candidate recorded `unjudged` is not sent to the judge at the next session end with no new close." | diff-local |
| Story 4 negative: Given a candidate was recorded `unjudged` for its current close, when the next BUILD session ends with no new close, then it is not sent to the judge again. | 12, 3 | "A step runner without `dispatchRemediationClosureJudgement` records every candidate `unjudged` and restages nothing, and a candidate recorded `unjudged` is not sent to the judge at the next session end with no new close." | diff-local |
| Story 5 happy: Given a remediation task judged `persists` on two successive closes, when each verdict is applied, then the task is reopened both times. | 10 | "Three successive `persists` closes of one task reopen it after the first two and, after the third, leave it completed with no `remediation-closure` obligation admitted, the pass's `remediation_closure_judged` event names it with disposition `bound-exhausted`, and BUILD completes and hands off." | diff-local |
| Story 5 happy: Given a remediation task that has already been reopened twice is judged `persists` on its third close, when the BUILD session ends, then the task is not reopened, it stays completed, no `remediation-closure` obligation is admitted, the event names it `bound-exhausted`, and BUILD hands off. | 10 | "Three successive `persists` closes of one task reopen it after the first two and, after the third, leave it completed with no `remediation-closure` obligation admitted, the pass's `remediation_closure_judged` event names it with disposition `bound-exhausted`, and BUILD completes and hands off." | diff-local |
| Story 5 negative: Given a remediation task is judged `persists` on the last BUILD attempt the step's retry cap allows, when the BUILD session ends, then the task is not reopened, the event names it `bound-exhausted`, and BUILD hands off instead of failing. | 10 | "A `persists` verdict on the last BUILD attempt the step's retry cap allows admits no obligation, leaves the task completed, the pass's `remediation_closure_judged` event names it with disposition `bound-exhausted`, and BUILD completes and hands off instead of failing." | diff-local |
| Story 5 negative: Given the engine restarts after a remediation task was reopened, when BUILD is resumed, then the task's reopen count is unchanged and the retry hint naming it is rebuilt from its open obligation. | 11 | "After a reopen, a fresh conductor started on the same worktree reads the task's reopen count unchanged, and its first BUILD attempt's retry hint contains the open obligation's instruction naming the task id and the judge's rationale." | diff-local |
| Story 5 negative: Given the engine stops at any point while a non-resolved verdict is being applied, when it restarts, then the task is never left completed with that verdict and no open obligation, and its reopen count is never incremented twice for one close. | 11 | "A stop simulated after the verdict write, after the admission, or after the restage of a `persists` application, followed by the next BUILD session end, leaves exactly one open `remediation-closure` obligation, the task row `pending`, and the reopen count incremented exactly once." | diff-local |
| Story 5 negative: Given the persisted verdict record is present but malformed, when the BUILD session ends, then BUILD is not complete and its reason names the malformed remediation-closure verdict record. | 11, 1 | "With a malformed `remediationClosure` section in `engine-state.json`, a BUILD session ending with every task resolved is not complete, its reason names the malformed remediation-closure verdict record, and no `dispatchRemediationClosureJudgement` call is made." | diff-local |
| Story 6 happy: Given a judgement runs, when it completes, then exactly one `remediation_closure_judged` event is emitted carrying the outcome, the attempt count, and for each candidate its task id, verdict, rationale, and whether it was reopened, left closed, or `bound-exhausted`. | 14, 10 | "A pass judging `rem-as-built-R11` `persists` and `rem-as-built-R5` `resolved` persists exactly one `remediation_closure_judged` line to `.pipeline/events.jsonl` with outcome `judged`, its attempt count, and per task the id, verdict, rationale and disposition `reopened` or `left-closed`." | diff-local |
| Story 6 happy: Given the event is emitted, when `.pipeline/events.jsonl` is read, then the event is persisted there and the event-sink declarations include `remediation_closure_judged`. | 14 | "`EVENT_SINKS` has a `remediation_closure_judged` row with `persist: true`, and the audit-trail completeness classification lists `remediation_closure_judged`." | diff-local |
| Story 6 negative: Given no candidates exist, when the BUILD session ends, then no `remediation_closure_judged` event is emitted. | 14 | "A BUILD session end with no candidates, including a plan with no `rem-*` task, persists no `remediation_closure_judged` event and makes no `dispatchRemediationClosureJudgement` call." | diff-local |
| Story 6 negative: Given the judgement handed off unjudged, when its event is read, then the outcome is `unjudged` and no candidate carries a verdict other than `unjudged`. | 14 | "A pass that handed off unjudged persists one event with outcome `unjudged` in which every candidate's verdict is `unjudged`, and a pass whose port returned verdicts on its second attempt applies those verdicts and persists `attempts: 2`." | diff-local |
| Story 7 happy: Given a BUILD session ends with a pending `[test]` citation on ordinary task 4 and a completed remediation task with no verdict for its current close, when the boundary runs, then the citation judgement is dispatched before the remediation-closure judgement and both run before the BUILD completion predicate is evaluated. | 7 | "A BUILD session ending with a pending citation on task 4 and two remediation candidates makes the `dispatchDoneWhenCitationJudgement` call before exactly one `dispatchRemediationClosureJudgement` call whose input covers both candidates, and both calls precede the BUILD completion predicate." | diff-local |
| Story 7 happy: Given in one pass the citation judgement refuses a check of task 4 and the remediation-closure judge returns `persists` for `rem-as-built-R5`, when BUILD's completion reason is written, then it carries the `Done-when citation refused:` line for task 4 first and the `Remediation closure reopened:` line for `rem-as-built-R5` after it. | 9 | "When the same pass refuses task 4's citation and reopens `rem-as-built-R5`, the completion reason carries the `Done-when citation refused:` line first and the `Remediation closure reopened:` line after it, and the next BUILD attempt's retry hint names `rem-as-built-R5` and the judge's rationale." | diff-local |
| Story 7 negative: Given a completed remediation task whose `[test]` check the citation judgement refused in this pass, when the remediation-closure candidates are selected, then that task is not a candidate and only one obligation is open for it. | 7, 3 | "A remediation task whose `pending-judgement` record is demoted to `unverified` because the citation judgement is unavailable is in the same pass's `dispatchRemediationClosureJudgement` input, and a remediation task whose citation was refused in that pass is absent from it and has exactly one open obligation." | diff-local |
| Story 7 negative: Given a completed remediation task holding a `pending-judgement` record, when the citation judgement is unavailable and demotes that record to `unverified` in this pass, then that task is a remediation-closure candidate in the same pass. | 7 | "A remediation task whose `pending-judgement` record is demoted to `unverified` because the citation judgement is unavailable is in the same pass's `dispatchRemediationClosureJudgement` input, and a remediation task whose citation was refused in that pass is absent from it and has exactly one open obligation." | diff-local |
| Story 7 negative: Given every plan task is resolved, no check is unverified, no citation is pending judgement, and every completed remediation task holds a `resolved` verdict for its current close, when the BUILD session ends, then BUILD completes with neither prefix in its reason. | 7 | "When every candidate is judged `resolved`, BUILD completes with neither `Done-when citation refused:` nor `Remediation closure reopened:` in its reason, each verdict is recorded for its close identity, and the next session end with no new close makes no `dispatchRemediationClosureJudgement` call." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-21-remediation-closure-judgement#D1 | task | task-7, task-8, task-9 | A BUILD session ending with a pending citation on task 4 and two remediation candidates makes the `dispatchDoneWhenCitationJudgement` call before exactly one `dispatchRemediationClosureJudgement` call whose input covers both candidates, and both calls precede the BUILD completion predicate. |
| adr-2026-10-21-remediation-closure-judgement#D2 | task | task-3, task-8 | `remediationCloseIdentity` returns the same digest when only a record's `source`, the row's `commit`, its `startHead`, or the task's `Task:` trailers differ, and a different digest when the reopen count or a record's check text or evidence differs. |
| adr-2026-10-21-remediation-closure-judgement#D3 | task | task-4 | For a candidate with a `Task:` trailer commit and a `reported` evidence value naming a second resolving SHA, `buildRemediationClosureInput` carries the plan block's title, Rationale, Criterion, Governing clause and Done-when checks, each check's close-record source, and both commits' diffs. |
| adr-2026-10-21-remediation-closure-judgement#D4 | task | task-6 | With `steps.build_review.llm_provider` set to two schema-capable providers different from BUILD's, `dispatchRemediationClosureJudgement` makes one free-form provider call, an engine-rendered prompt with no skill invocation, under the `build_review` selection in order with the model and effort resolved for `build_review`, while its lifecycle supervision events name the `build` step and no `build_review` session is opened. |
| adr-2026-10-21-remediation-closure-judgement#D5 | task | task-6 | When the HEAD read after an attempt differs from the HEAD read before it, that attempt's output is discarded and counted as a failed attempt. |
| adr-2026-10-21-remediation-closure-judgement#D6 | task | task-5 | `validateRemediationClosureOutput` returns an invalid result for each of: a missing candidate id, an extra non-candidate task id, a key other than `taskId`, `verdict` and `rationale`, a verdict outside `resolved`, `persists` and `partial`, and an empty rationale. |
| adr-2026-10-21-remediation-closure-judgement#D7 | task | task-12 | When `dispatchRemediationClosureJudgement` returns `unavailable` after two failed attempts, every candidate is recorded `unjudged` for its current close identity, no obligation is admitted, no task is restaged, and BUILD completes when nothing else withholds it. |
| adr-2026-10-21-remediation-closure-judgement#D8 | task | task-2, task-9 | A `persists` verdict for `rem-as-built-R11` with a BUILD attempt left admits one settled obligation with authority `remediation-closure`, finding id equal to its close identity and instruction naming the task id and the judge's rationale, restages the row `pending`, withholds BUILD completion with a reason starting `Remediation closure reopened:` that names `rem-as-built-R11`, its title and the rationale, and no `test_suite` dispatch follows. |
| adr-2026-10-21-remediation-closure-judgement#D9 | task | task-10 | Three successive `persists` closes of one task reopen it after the first two and, after the third, leave it completed with no `remediation-closure` obligation admitted, the pass's `remediation_closure_judged` event names it with disposition `bound-exhausted`, and BUILD completes and hands off. |
| adr-2026-10-21-remediation-closure-judgement#D10 | task | task-11, task-13 | `isNoTaskProgressBuildStall` returns false at attempt 2 or later when the resolved count fell, HEAD did not move, and the completion reason starts with `Remediation closure reopened:`, and still returns true for the same inputs with a reason outside the three exempt prefixes. |
| adr-2026-10-21-remediation-closure-judgement#D11 | task | task-1, task-11, task-14 | A pass judging `rem-as-built-R11` `persists` and `rem-as-built-R5` `resolved` persists exactly one `remediation_closure_judged` line to `.pipeline/events.jsonl` with outcome `judged`, its attempt count, and per task the id, verdict, rationale and disposition `reopened` or `left-closed`. |
| adr-2026-08-22-done-when-evidence-at-task-close#D1 | existing | none | `completeTaskDoneWhen` (`task-progress.ts`) already writes one engine-owned close record per enumerated check before setting the row `completed`; this feature reads those records and adds no writer. |
| adr-2026-08-22-done-when-evidence-at-task-close#D2 | existing | none | Tasks without a `Done when:` block still close on the prior rule through `parsePlanTaskDoneWhen`; no task changes that branch. |
| adr-2026-08-22-done-when-evidence-at-task-close#D3 | existing | none | `conduct task done --plan-gap` still writes the classified plan-gap HALT (`task-cli.ts`); the remediation-closure judgement never routes to plan-gap. |
| adr-2026-08-22-done-when-evidence-at-task-close#D4 | no-change | none | No task adds a trailer floor; `Task:` trailer commits are passed to the judge as context only and never resolve or prove a task. |
| adr-2026-08-22-done-when-evidence-at-task-close#D5 | no-change | none | No task changes the `[test]` tag or its land validation; the judgement reads check text only. |
| adr-2026-08-22-done-when-evidence-at-task-close#D6 | existing | none | Text verification of `[test]` references at task close (`done-when-test-reference.ts`) is unchanged; remediation tasks keep closing through it. |
| adr-2026-08-22-done-when-evidence-at-task-close#D7 | existing | none | A refused tagged check still prints the write-or-cite refusal and never routes to plan-gap (`task-progress.ts`); unchanged here. |
| adr-2026-08-22-done-when-evidence-at-task-close#D8 | task | task-9 | A `persists` verdict for `rem-as-built-R11` with a BUILD attempt left admits one settled obligation with authority `remediation-closure`, finding id equal to its close identity and instruction naming the task id and the judge's rationale, restages the row `pending`, withholds BUILD completion with a reason starting `Remediation closure reopened:` that names `rem-as-built-R11`, its title and the rationale, and no `test_suite` dispatch follows. |
| adr-2026-08-22-done-when-evidence-at-task-close#D9 | existing | none | `buildRemediationDoneWhenChecks` (`remediation-append.ts`) already tags criterion-bound `prd_audit` remediation checks `[test]`; unchanged. |
| adr-2026-08-22-done-when-evidence-at-task-close#D10 | no-change | none | `startHead` recording is unchanged; the close identity deliberately excludes `startHead`. |
| adr-2026-08-22-done-when-evidence-at-task-close#D11 | existing | none | Start-window provenance (`classifyCitationProvenance`) is unchanged; remediation closure judges plan blocks, not test provenance. |
| adr-2026-08-22-done-when-evidence-at-task-close#D12 | existing | none | `pending-judgement` stamping in `completeTaskDoneWhen` is unchanged; such tasks are excluded from remediation candidates for that pass. |
| adr-2026-08-22-done-when-evidence-at-task-close#D13 | task | task-7 | A BUILD session ending with a pending citation on task 4 and two remediation candidates makes the `dispatchDoneWhenCitationJudgement` call before exactly one `dispatchRemediationClosureJudgement` call whose input covers both candidates, and both calls precede the BUILD completion predicate. |
| adr-2026-08-22-done-when-evidence-at-task-close#D14 | task | task-7 | A remediation task whose `pending-judgement` record is demoted to `unverified` because the citation judgement is unavailable is in the same pass's `dispatchRemediationClosureJudgement` input, and a remediation task whose citation was refused in that pass is absent from it and has exactly one open obligation. |
| adr-2026-08-22-done-when-evidence-at-task-close#D15 | task | task-7 | A remediation task whose `pending-judgement` record is demoted to `unverified` because the citation judgement is unavailable is in the same pass's `dispatchRemediationClosureJudgement` input, and a remediation task whose citation was refused in that pass is absent from it and has exactly one open obligation. |
| adr-2026-08-22-done-when-evidence-at-task-close#D16 | task | task-8 | A task judged `resolved` is not sent to the judge again at the next session end after `translateAfterRebase` rewrote its row's `commit` and `startHead`, or after `done-when accept` or citation settlement rewrote a record's `source`, with no new close. |
| adr-2026-08-22-done-when-evidence-at-task-close#D17 | no-change | none | No close-record source is added; the remediation-closure verdict lives in its own engine-state section, never in `source`. |
| adr-2026-08-22-done-when-evidence-at-task-close#D18 | existing | none | `done_when_citation_judged` and `done_when_citation_accepted` events are unchanged (`event-sinks.ts`); the new pass emits its own event. |
| adr-2026-08-22-done-when-evidence-at-task-close#D19 | task | task-7, task-9, task-13 | When the same pass refuses task 4's citation and reopens `rem-as-built-R5`, the completion reason carries the `Done-when citation refused:` line first and the `Remediation closure reopened:` line after it, and the next BUILD attempt's retry hint names `rem-as-built-R5` and the judge's rationale. |
| adr-2026-09-06-reopened-task-resolution#D1 | task | task-1 | `recordRemediationClosureVerdicts` writes through `createEngineStateStore(...).update` and leaves the `repairObligations` section and every other sibling field of `engine-state.json` byte-identical. |
| adr-2026-09-06-reopened-task-resolution#D2 | task | task-11 | A stop simulated after the verdict write, after the admission, or after the restage of a `persists` application, followed by the next BUILD session end, leaves exactly one open `remediation-closure` obligation, the task row `pending`, and the reopen count incremented exactly once. |
| adr-2026-09-06-reopened-task-resolution#D3 | task | task-1 | `recordRemediationClosureVerdicts` writes through `createEngineStateStore(...).update` and leaves the `repairObligations` section and every other sibling field of `engine-state.json` byte-identical. |
| adr-2026-09-06-reopened-task-resolution#D4 | task | task-9 | After the reopen, `resolveTaskIdsWithDiagnostics` does not resolve the task from its pre-reopen `Task:` commit but resolves it from a new `Task:` commit past the obligation boundary or a fresh Done-when close, the next session end then sends it to the judge, and the kickback ledger and `readPlanGrowthBudget` read identical before and after the reopen. |
| adr-2026-09-06-reopened-task-resolution#D5 | existing | none | `listCommitsWithTrailersAfterRepairBoundary` already refuses to widen past an unavailable boundary; the new obligation uses the same reader. |
| adr-2026-09-06-reopened-task-resolution#D6 | existing | none | Resolver, task seeding and task close already share `taskObligationStanding`; the new authority is read through it unchanged. |
| adr-2026-09-06-reopened-task-resolution#D7 | no-change | none | Scope acceptance of OVER_SCOPE findings is untouched; a remediation-closure verdict is never an OVER_SCOPE finding. |
| adr-2026-09-06-reopened-task-resolution#D8 | no-change | none | The remediation-closure obligation has no governing review of its own and adds no repair retry counter; its reopen bound lives in the verdict section. |
| adr-2026-09-06-reopened-task-resolution#D9 | task | task-9 | After the reopen, `resolveTaskIdsWithDiagnostics` does not resolve the task from its pre-reopen `Task:` commit but resolves it from a new `Task:` commit past the obligation boundary or a fresh Done-when close, the next session end then sends it to the judge, and the kickback ledger and `readPlanGrowthBudget` read identical before and after the reopen. |
| adr-2026-09-06-reopened-task-resolution#D10 | no-change | none | Retired by #3164; `coverage_binding` admits nothing and this feature does not revive it. |
| adr-2026-09-06-reopened-task-resolution#D11 | task | task-2 | Admitting a `plan_amendment` obligation for a task with a live `remediation-closure` obligation leaves both live, and admitting a `remediation-closure` obligation for a task with a live `plan_amendment` obligation leaves both live. |
| adr-2026-09-06-reopened-task-resolution#D12 | task | task-8 | After the worktree is recreated and task seeding restores remediation tasks from `Task:` trailers with no verdict section, no restored task is sent to the judge or reopened, and a restored task later closed again with fresh Done-when evidence is sent to the judge at the next session end. |
| adr-2026-09-06-reopened-task-resolution#D13 | task | task-7 | A remediation task whose `pending-judgement` record is demoted to `unverified` because the citation judgement is unavailable is in the same pass's `dispatchRemediationClosureJudgement` input, and a remediation task whose citation was refused in that pass is absent from it and has exactly one open obligation. |
| adr-2026-09-06-reopened-task-resolution#D14 | task | task-2, task-9 | A `persists` verdict for `rem-as-built-R11` with a BUILD attempt left admits one settled obligation with authority `remediation-closure`, finding id equal to its close identity and instruction naming the task id and the judge's rationale, restages the row `pending`, withholds BUILD completion with a reason starting `Remediation closure reopened:` that names `rem-as-built-R11`, its title and the rationale, and no `test_suite` dispatch follows. |
| adr-2026-08-22-one-owner-per-review-question#D1 | task | task-9 | A `persists` verdict for `rem-as-built-R11` with a BUILD attempt left admits one settled obligation with authority `remediation-closure`, finding id equal to its close identity and instruction naming the task id and the judge's rationale, restages the row `pending`, withholds BUILD completion with a reason starting `Remediation closure reopened:` that names `rem-as-built-R11`, its title and the rationale, and no `test_suite` dispatch follows. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
