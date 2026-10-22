**Status:** Accepted

# Stories: Completed remediation tasks are judged against their named change before BUILD hands off

Track: technical (no PRD). Tier: M.
Architecture: `.docs/decisions/architecture-review-remediation-tasks-close-on-a-reported-commit-that-.md`
Sequence: `.docs/architecture/sequences/remediation-tasks-close-on-a-reported-commit-that-.md`
Governing decision: `adr-2026-10-21-remediation-closure-judgement` D1-D11.
Source: jstoup111/ai-conductor#3190

Scope: engine-appended `rem-*` remediation tasks only. Ordinary plan tasks and `[test]` Done-when verification at task close behave exactly as before.

## Story 1: A remediation task whose named change is absent is reopened before BUILD hands off

**Requirement:** adr-2026-10-21-remediation-closure-judgement D1, D8, D10

As the operator, I want BUILD to catch a remediation task that was closed without its repair, so that the miss is fixed inside BUILD instead of being rediscovered by the next as-built or PRD-audit lap.

### Acceptance Criteria

#### Happy Path
- Given every plan task is resolved, the worktree is clean, and a completed task `rem-as-built-R11` has no verdict for its current close, when the judge returns `persists` for it, then BUILD is not complete, its completion reason begins with `remediation closure judgement reopened:`, the `rem-as-built-R11` row is `pending`, and `test_suite` is not started.
- Given the judge returns `partial` for a completed remediation task, when BUILD's completion is evaluated, then that task is reopened exactly as a `persists` verdict reopens it.
- Given a remediation task was reopened by a `persists` verdict, when the next BUILD attempt is dispatched, then its retry hint names the task id and the judge's rationale for that task.

#### Negative Paths
- Given a reopened remediation task whose only evidence is a `Task:` trailer commit from before the reopen, when BUILD resolves task progress, then the task is still unresolved.
- Given a reopened remediation task, when a new commit with its `Task:` trailer lands after the reopen or the agent closes it again with fresh Done-when evidence, then the task resolves.
- Given a BUILD attempt ended with a closure-judgement reopen and the resolved-task count fell and HEAD did not move, when the stall detector evaluates the next attempt, then BUILD is not classified as `no_task_progress`.
- Given a remediation task is reopened by the judgement, when the kickback ledger and plan-growth allowance are read afterwards, then no gate lap and no plan growth were charged.

### Done When
- [ ] A conductor-level test drives BUILD to all-resolved with a stubbed judge returning `persists` and observes the task row `pending`, the prefixed completion reason, and no `test_suite` dispatch.
- [ ] The kickback ledger and plan-growth readings are unchanged across a closure-judgement reopen.

## Story 2: A resolved verdict lets BUILD hand off and stands until the task closes again

**Requirement:** adr-2026-10-21-remediation-closure-judgement D2, D3

As the operator, I want a remediation task that really carries its repair to pass straight through, and one commit to close several tasks when it implements each of them, so that the check costs nothing beyond the judgement itself.

### Acceptance Criteria

#### Happy Path
- Given every completed remediation task is judged `resolved`, when BUILD's completion is evaluated, then BUILD completes and hands off as it did before this change.
- Given one commit closes three remediation tasks and the judge returns `resolved` for two and `persists` for one, when BUILD's completion is evaluated, then only the `persists` task is reopened and the other two stay completed.

#### Negative Paths
- Given a remediation task already has a `resolved` verdict for its current close, when BUILD's completion is evaluated again with no new close of that task, then that task is not sent to the judge again.
- Given a plan with no engine-appended `rem-*` task, or whose remediation tasks all already have verdicts for their current closes, when BUILD's completion is evaluated, then no judgement is dispatched and no `remediation_closure_judged` event is emitted.
- Given a stacked feature whose remediation task belongs to a child other than the active child, when the active child's BUILD completion is evaluated, then that task is not judged.
- Given an ordinary plan task closed only with `reported` evidence, when BUILD's completion is evaluated, then it is never sent to the judge and BUILD completes on task resolution as before.

### Done When
- [ ] A test with three tasks closed by one commit and mixed verdicts shows exactly one task reopened.
- [ ] A test of a plan without remediation tasks shows zero judge dispatches and zero `remediation_closure_judged` events.

## Story 3: The judge sees the task's named change and its cited commits and cannot change the feature worktree

**Requirement:** adr-2026-10-21-remediation-closure-judgement D3, D4, D5

As the operator, I want the judge to grade each task against what its plan block names, using the commits that claim to deliver it, without being able to alter the code it is grading, so that its verdict is about the feature as built.

### Acceptance Criteria

#### Happy Path
- Given a completed remediation task with a `Task:` trailer commit and a `reported` Done-when evidence value naming another commit SHA that resolves, when the judgement prompt is rendered, then it contains the task's plan block (title, Rationale, Criterion, Governing clause and Done-when checks) and the diff of both commits.
- Given candidates exist, when the judgement is dispatched, then it is one dispatch covering every candidate, it invokes the `remediation-closure` skill, and its provider, model and effort are those resolved for the `build_review` step.
- Given the judgement is dispatched, when the judge runs, then its working directory is a detached checkout of the judged HEAD, and that checkout no longer exists after the judgement returns.

#### Negative Paths
- Given the cited commits' combined diff exceeds 48,000 bytes, when the prompt is rendered, then the diff is cut to 48,000 bytes and the prompt states that it was truncated.
- Given a `reported` Done-when evidence value contains text that looks like a SHA but does not resolve to a commit, when the prompt is rendered, then that text is ignored and the judgement still runs.
- Given the judge writes or deletes a file in its working directory, when the judgement returns, then the feature worktree's files, index and HEAD are byte-for-byte unchanged.
- Given the feature HEAD moved while the judgement was running, when the result returns, then the result is discarded and handled as a judge failure.

### Done When
- [ ] A rendered-prompt test asserts the plan block, both cited diffs, and the truncation notice for an oversized diff.
- [ ] A test with a judge that writes into its working directory shows `git status --porcelain` and HEAD of the feature worktree unchanged and the detached checkout removed.

## Story 4: A failed judgement retries once, then hands off unjudged

**Requirement:** adr-2026-10-21-remediation-closure-judgement D6, D7

As the operator, I want a broken or misbehaving judge never to wedge BUILD, so that a provider problem costs at most one retry and is visible on the event spine.

### Acceptance Criteria

#### Happy Path
- Given the first judgement returns output that fails the result schema and the immediate retry returns a valid result, when BUILD's completion is evaluated, then the retry's verdicts are applied and the event records two attempts.

#### Negative Paths
- Given the judgement fails the schema on both attempts, when BUILD's completion is evaluated, then no task is reopened, BUILD hands off, every candidate is recorded `unjudged` for its current close, and the event records outcome `unjudged`.
- Given a result that omits a candidate id, adds a task id that was not a candidate, carries a key other than `taskId`, `verdict` and `rationale`, has a verdict other than `resolved`, `persists` or `partial`, or has an empty rationale, when it is parsed, then it is a judge failure.
- Given the provider dispatch throws or reports failure, when BUILD's completion is evaluated, then it is a judge failure handled by the same single retry.
- Given a step runner with no remediation-closure dispatch port, when BUILD's completion is evaluated with candidates, then BUILD hands off and the candidates are recorded `unjudged`.
- Given a candidate was recorded `unjudged` for its current close, when BUILD's completion is evaluated again with no new close, then it is not sent to the judge again.

### Done When
- [ ] Table-driven parser tests cover each malformed result shape listed above and each yields a judge failure.
- [ ] A test with a judge failing twice shows exactly two dispatches, BUILD complete, and an `unjudged` event.

## Story 5: Reopens are bounded per task and by the BUILD retry budget

**Requirement:** adr-2026-10-21-remediation-closure-judgement D9, D10

As the operator, I want a task the judge keeps rejecting to stop consuming BUILD attempts, so that a wrong verdict costs at most two retries and the downstream gates still get the final word.

### Acceptance Criteria

#### Happy Path
- Given a remediation task judged `persists` on two successive closes, when each verdict is applied, then the task is reopened both times.
- Given a remediation task that has already been reopened twice is judged `persists` on its third close, when BUILD's completion is evaluated, then the task is not reopened, it stays completed, the event names it `bound-exhausted`, and BUILD hands off.

#### Negative Paths
- Given a remediation task is judged `persists` on the last BUILD attempt the step's retry cap allows, when BUILD's completion is evaluated, then the task is not reopened, the event names it `bound-exhausted`, and BUILD hands off instead of failing.
- Given the engine restarts after a remediation task was reopened, when BUILD is resumed, then the task's reopen count is unchanged and the retry hint naming it is rebuilt from its open obligation.
- Given the engine stops at any point while a non-resolved verdict is being applied, when it restarts, then the task is never left completed with that verdict and no open obligation, and its reopen count is never incremented twice for one close.
- Given the persisted verdict record is present but malformed, when BUILD's completion is evaluated, then BUILD is not complete and its reason names the malformed remediation-closure verdict record.

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
- Given no candidates exist, when BUILD's completion is evaluated, then no `remediation_closure_judged` event is emitted.
- Given the judgement handed off unjudged, when its event is read, then the outcome is `unjudged` and no candidate carries a verdict other than `unjudged`.

### Done When
- [ ] The `ConductorEvent` union, event-sink declarations and audit-trail completeness classification include `remediation_closure_judged`.
- [ ] A persisted-event test reads the variant back from `.pipeline/events.jsonl` with every listed field.
