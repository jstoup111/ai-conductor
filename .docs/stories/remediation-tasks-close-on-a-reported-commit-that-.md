**Status:** Accepted

# Stories: Completed remediation tasks are judged against their named change before BUILD hands off

Track: technical (no PRD). Tier: M.
Architecture: `.docs/decisions/architecture-review-remediation-tasks-close-on-a-reported-commit-that-.md`
Sequence: `.docs/architecture/sequences/remediation-tasks-close-on-a-reported-commit-that-.md`
Governing decision: `adr-2026-10-21-remediation-closure-judgement` D1-D11.
Source: jstoup111/ai-conductor#3190

Scope: engine-appended `rem-*` remediation tasks only. Ordinary plan tasks, `[test]` Done-when verification at task close, and the #3200 citation judgement behave exactly as before.

## Story 1: A remediation task whose named change is absent is reopened before BUILD hands off

**Requirement:** adr-2026-10-21-remediation-closure-judgement D1, D8, D10; adr-2026-09-06-reopened-task-resolution D14

As the operator, I want BUILD to catch a remediation task that was closed without its repair, so that the miss is fixed inside BUILD instead of being rediscovered by the next as-built or PRD-audit lap.

### Acceptance Criteria

#### Happy Path
- Given every plan task is resolved, the worktree is clean, and a completed task `rem-as-built-R11` has no verdict for its current close, when the BUILD session ends and the judge returns `persists` for it, then BUILD is not complete, its completion reason begins with `Remediation closure reopened:` and names `rem-as-built-R11` by id and title with the judge's rationale, the `rem-as-built-R11` row is `pending`, and `test_suite` is not started.
- Given the judge returns `partial` for a completed remediation task, when the BUILD session ends, then that task is reopened exactly as a `persists` verdict reopens it.
- Given a remediation task was reopened by a `persists` verdict, when the next BUILD attempt is dispatched, then its retry hint names the task id and the judge's rationale for that task.

#### Negative Paths
- Given a reopened remediation task whose only evidence is a `Task:` trailer commit from before the reopen, when BUILD resolves task progress, then the task is still unresolved.
- Given a reopened remediation task, when a new commit with its `Task:` trailer lands after the reopen or the agent closes it again with fresh Done-when evidence, then the task resolves.
- Given a BUILD attempt ended with a closure-judgement reopen and the resolved-task count fell and HEAD did not move, when the stall detector evaluates the next attempt, then BUILD is not classified as `no_task_progress`.
- Given a remediation task is reopened by the judgement, when the kickback ledger and plan-growth allowance are read afterwards, then no gate lap and no plan growth were charged.

### Done When
- [ ] A conductor-level test drives BUILD to all-resolved with a stubbed judge returning `persists` and observes the task row `pending`, an open `remediation-closure` obligation, the prefixed completion reason, and no `test_suite` dispatch.
- [ ] The kickback ledger and plan-growth readings are unchanged across a closure-judgement reopen.

## Story 2: A resolved verdict lets BUILD hand off and stands until the task closes again

**Requirement:** adr-2026-10-21-remediation-closure-judgement D2, D3

As the operator, I want a remediation task that really carries its repair to pass straight through, and one commit to close several tasks when it implements each of them, so that the check costs nothing beyond the judgement itself.

### Acceptance Criteria

#### Happy Path
- Given every completed remediation task is judged `resolved`, when the BUILD session ends, then BUILD completes and hands off as it did before this change.
- Given one commit closes three remediation tasks and the judge returns `resolved` for two and `persists` for one, when the BUILD session ends, then only the `persists` task is reopened and the other two stay completed.

#### Negative Paths
- Given a remediation task already has a `resolved` verdict for its current close, when the next BUILD session ends with no new close of that task, then that task is not sent to the judge again.
- Given a plan with no engine-appended `rem-*` task, or whose remediation tasks all already have verdicts for their current closes, when the BUILD session ends, then no remediation-closure judgement is dispatched and no `remediation_closure_judged` event is emitted.
- Given a stacked feature whose remediation task belongs to a child other than the execution child, when the execution child's BUILD session ends, then that task is not judged.
- Given a stacked feature with a routed repair open on host child k, when child k's BUILD session ends with a completed remediation task recorded to child k, then that task is judged and a `persists` verdict admits its obligation with the boundary `{branch, head}` of child k's branch taken at admission.
- Given a judged remediation task whose branch was rebased and whose Done-when close records are unchanged, when the next BUILD session ends, then that task is not sent to the judge again.
- Given an ordinary plan task closed only with `reported` evidence, when the BUILD session ends, then it is never sent to the remediation-closure judge and BUILD completes on task resolution as before.
- Given every plan task is resolved, the worktree has an uncommitted tracked change or an untracked file that is not ignored, and a completed remediation task has no verdict for its current close, when the BUILD session ends, then no remediation-closure judgement is dispatched, no verdict is recorded, and BUILD is not complete for the dirty tree.
- Given a worktree recreated from its branch so its remediation tasks are restored from `Task:` trailers and no verdict record exists, when the BUILD session ends, then no restored remediation task is sent to the judge and none is reopened.
- Given a remediation task judged `resolved` whose check source is later rewritten by citation settlement or by `done-when accept`, when the next BUILD session ends with no new close of that task, then it is not sent to the judge again.
- Given a remediation task reopened by the judgement and later resolved only by a new `Task:` trailer commit past its obligation boundary, when the next BUILD session ends, then that task is sent to the judge for its new close.

### Done When
- [ ] A test with three tasks closed by one commit and mixed verdicts shows exactly one task reopened.
- [ ] A test of a plan without remediation tasks shows zero judge dispatches and zero `remediation_closure_judged` events.

## Story 3: The judge sees the task's named change and its cited commits and cannot change the feature worktree

**Requirement:** adr-2026-10-21-remediation-closure-judgement D3, D4, D5

As the operator, I want the judge to grade each task against what its plan block names, using the commits that claim to deliver it, without being able to alter the code it is grading, so that its verdict is about the feature as built.

### Acceptance Criteria

#### Happy Path
- Given a completed remediation task with a `Task:` trailer commit and a `reported` Done-when evidence value naming another commit SHA that resolves, when the judgement input is built, then it contains the task's plan block (title, Rationale, Criterion, Governing clause and Done-when checks), each check's close-record source, and the diff of both commits.
- Given candidates exist, when the judgement is dispatched, then it is one free-form dispatch covering every candidate, it carries the native output schema and the read-only review flag, its working directory is the feature worktree, and its provider, model and effort are those resolved from the `build_review` step's configuration while the dispatch is attributed to the running BUILD step.

#### Negative Paths
- Given the cited commits' combined diff exceeds 48,000 bytes, when the judgement input is built, then the diff is cut to 48,000 bytes and the input states that it was truncated.
- Given a `reported` Done-when evidence value contains text that looks like a SHA but does not resolve to a commit, when the judgement input is built, then that text is ignored and the judgement still runs.
- Given a candidate whose only non-resolved signal is a check closed `unverified`, when the judgement input is built, then that check's source is given as `unverified` and the input's instruction says an `unverified` close is not by itself grounds for `persists` or `partial`.
- Given no configured provider for the `build_review` step declares native output schema support, when the judgement is dispatched, then the dispatch is unavailable and no provider is invoked.
- Given the feature HEAD differs when the dispatch returns from the HEAD it started at, when the result is read, then the result is discarded and handled as a failed dispatch.

### Done When
- [ ] An input-builder test asserts the plan block, the close-record sources, both cited diffs, and the truncation notice for an oversized diff.
- [ ] A step-runner test asserts the dispatch resolves its provider from `steps.build_review` while its lifecycle events name the `build` step, passes `readOnlyReview` and the native schema, and returns unavailable with no invocation when no provider declares native schema support.

## Story 4: A failed judgement retries once, then hands off unjudged

**Requirement:** adr-2026-10-21-remediation-closure-judgement D6, D7

As the operator, I want a broken or misbehaving judge never to wedge BUILD, so that a provider problem costs at most one retry and is visible on the event spine.

### Acceptance Criteria

#### Happy Path
- Given the first dispatch returns output that fails the result schema and the immediate retry returns a valid result, when the BUILD session ends, then the retry's verdicts are applied and the event records two attempts.

#### Negative Paths
- Given the dispatch fails the schema on both attempts, when the BUILD session ends, then no task is reopened, every candidate is recorded `unjudged` for its current close, the event records outcome `unjudged`, and BUILD completes when nothing else withholds it.
- Given a result that omits a candidate id, adds a task id that was not a candidate, carries a key other than `taskId`, `verdict` and `rationale`, has a verdict other than `resolved`, `persists` or `partial`, or has an empty rationale, when it is validated, then it is a failed dispatch.
- Given the provider dispatch throws or reports failure, when the BUILD session ends, then it is a failed dispatch handled by the same single retry.
- Given a step runner with no remediation-closure dispatch port, when the BUILD session ends with candidates, then the candidates are recorded `unjudged` and no task is reopened.
- Given a candidate was recorded `unjudged` for its current close, when the next BUILD session ends with no new close, then it is not sent to the judge again.

### Done When
- [ ] Table-driven validator tests cover each malformed result shape listed above and each yields a failed dispatch.
- [ ] A test with a dispatch failing twice shows exactly two provider invocations, BUILD complete, and an `unjudged` event.

## Story 5: Reopens are bounded per task and by the BUILD retry budget

**Requirement:** adr-2026-10-21-remediation-closure-judgement D9, D10

As the operator, I want a task the judge keeps rejecting to stop consuming BUILD attempts, so that a wrong verdict costs at most two retries and the downstream gates still get the final word.

### Acceptance Criteria

#### Happy Path
- Given a remediation task judged `persists` on two successive closes, when each verdict is applied, then the task is reopened both times.
- Given a remediation task that has already been reopened twice is judged `persists` on its third close, when the BUILD session ends, then the task is not reopened, it stays completed, no `remediation-closure` obligation is admitted, the event names it `bound-exhausted`, and BUILD hands off.

#### Negative Paths
- Given a remediation task is judged `persists` on the last BUILD attempt the step's retry cap allows, when the BUILD session ends, then the task is not reopened, the event names it `bound-exhausted`, and BUILD hands off instead of failing.
- Given the engine restarts after a remediation task was reopened, when BUILD is resumed, then the task's reopen count is unchanged and the retry hint naming it is rebuilt from its open obligation.
- Given the engine stops at any point while a non-resolved verdict is being applied, when it restarts, then the task is never left completed with that verdict and no open obligation, and its reopen count is never incremented twice for one close.
- Given the persisted verdict record is present but malformed, when the BUILD session ends, then BUILD is not complete and its reason names the malformed remediation-closure verdict record.

### Done When
- [ ] A test of three successive `persists` closes shows two reopens and one `bound-exhausted` hand-off.
- [ ] A restart test shows the reopen count and the rebuilt retry hint survive.

## Story 6: Every judgement is visible on the event spine

**Requirement:** adr-2026-10-21-remediation-closure-judgement D11

As the operator, I want each judgement and what it did to appear where every other engine occurrence appears, so that the daemon log, UI and traces show why a remediation task reopened or passed.

### Acceptance Criteria

#### Happy Path
- Given a judgement runs, when it completes, then exactly one `remediation_closure_judged` event is emitted carrying the outcome, the attempt count, and for each candidate its task id, verdict, rationale, and whether it was reopened, left closed, or `bound-exhausted`.
- Given the event is emitted, when `.pipeline/events.jsonl` is read, then the event is persisted there and the event-sink declarations include `remediation_closure_judged`.

#### Negative Paths
- Given no candidates exist, when the BUILD session ends, then no `remediation_closure_judged` event is emitted.
- Given the judgement handed off unjudged, when its event is read, then the outcome is `unjudged` and no candidate carries a verdict other than `unjudged`.

### Done When
- [ ] The `ConductorEvent` union, event-sink declarations and audit-trail completeness classification include `remediation_closure_judged`.
- [ ] A persisted-event test reads the variant back from `.pipeline/events.jsonl` with every listed field.

## Story 7: The remediation-closure judgement and the citation judgement never act twice on one close

**Requirement:** adr-2026-10-21-remediation-closure-judgement D1, D2; adr-2026-08-22-done-when-evidence-at-task-close D19

As the operator, I want the two BUILD-boundary judgements to run in a fixed order and never both reopen the same task in one pass, so that one close costs at most one repair attempt and the reason says why.

### Acceptance Criteria

#### Happy Path
- Given a BUILD session ends with a pending `[test]` citation on ordinary task 4 and a completed remediation task with no verdict for its current close, when the boundary runs, then the citation judgement is dispatched before the remediation-closure judgement and both run before the BUILD completion predicate is evaluated.
- Given in one pass the citation judgement refuses a check of task 4 and the remediation-closure judge returns `persists` for `rem-as-built-R5`, when BUILD's completion reason is written, then it carries the `Done-when citation refused:` line for task 4 first and the `Remediation closure reopened:` line for `rem-as-built-R5` after it.

#### Negative Paths
- Given a completed remediation task whose `[test]` check the citation judgement refused in this pass, when the remediation-closure candidates are selected, then that task is not a candidate and only one obligation is open for it.
- Given a completed remediation task holding a `pending-judgement` record, when the citation judgement is unavailable and demotes that record to `unverified` in this pass, then that task is a remediation-closure candidate in the same pass.
- Given every plan task is resolved, no check is unverified, no citation is pending judgement, and every completed remediation task holds a `resolved` verdict for its current close, when the BUILD session ends, then BUILD completes with neither prefix in its reason.

### Done When
- [ ] A conductor-level test with both a pending citation and a remediation candidate records the two dispatches in order and both reason lines in order.
- [ ] A candidate-selection test excludes a remediation task with an open `done-when-citation` obligation or a `pending-judgement` record.
