**Status:** Accepted

# coverage_binding refuses plans that contradict sealed criteria or approved ADR decisions (#2750)

Track: technical (no PRD — acceptance criteria live here)
Tier: M
Governing decisions: `adr-2026-08-31-coverage-binding-judge-step` D21, D22, D23, D24 and `adr-2026-08-22-one-owner-per-review-question` D1 (both amended 2026-10-03 by #2750); architecture review conditions 1–4.

## Story 1: A task that contradicts a sealed story criterion halts before any build task

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D21

As the daemon operator, I want `coverage_binding` to refuse a plan when any task, cited or not, requires an outcome that a sealed story criterion forbids, so that an impossible plan stops before BUILD instead of halting in SHIP.

### Acceptance Criteria

#### Happy Path
- Given the coverage_binding judge is enabled and a plan whose Task 3 and Task 20 assert a policy-forbidden provider candidate is absent from the candidate list and from attempt records while uncited Task 8 requires a `provider_attempt` record for that forbidden candidate, and a sealed criterion requires the forbidden candidate to be absent from the records, when `coverage_binding` runs, then the conflict claim sent to the judge for that criterion carries the `Done when` checks of Task 3, Task 8, and Task 20
- Given the judge returns `conflicts` naming Task 8 for that criterion, when the step completes, then it is refused with kind `needs-human` before any build task is dispatched, and the refusal names the criterion text, Task 8, Task 8's `Done when` checks, and the judge's conflict statement
- Given a plan whose invalidation-model task erases judge-disabled provenance and a sealed negative criterion requiring that a judge-disabled claim is never reopened, when the judge returns `conflicts` naming that task, then the step refuses `needs-human` naming that criterion and that task
- Given a plan whose Task 8 requires `endpoint` assertions and a sealed criterion requiring a credential-only assertion diff, when the judge returns `conflicts` naming Task 8, then the step refuses `needs-human` naming that criterion and Task 8

#### Negative Paths
- Given a sealed criterion that no coverage row cites, when `coverage_binding` assembles conflict claims, then that criterion still receives a conflict claim judged against every plan task
- Given a plan task with no `Done when` block, when conflict claims are assembled, then that task appears in the task table with its id and title and no checks, and the claim is still judged
- Given a stories file from which no criterion can be extracted, when `coverage_binding` runs with the judge enabled, then its criterion conflict claims are recorded `not-applicable` and the step neither refuses nor dispatches the judge for them
- Given a plan in which no task has a `Done when` block, when `coverage_binding` runs with the judge enabled, then every conflict claim is recorded `not-applicable` and the step does not refuse on them
- Given a reseal re-ran the step on a feature with completed tasks, a changed criterion coverage claim would otherwise reopen a completed task, and a conflict claim returns `conflicts`, when the step completes, then it refuses `needs-human`, no completed task is reopened, no plan task is appended, and no step is routed to `plan`
- Given a reseal re-ran the step, the previous envelope has no conflict entries, and every conflict claim returns `consistent`, when the step completes, then no completed task is reopened because of a conflict entry's digest

### Done When
- [ ] A fixture reproducing case 1 of #2750 (Task 3 and Task 20 versus Task 8) asserts the criterion's conflict claim carries all three tasks' `Done when` checks and that a stubbed `conflicts` verdict refuses `needs-human` naming the criterion and Task 8
- [ ] Fixtures reproducing cases 2 and 3 of #2750 assert a stubbed `conflicts` verdict refuses `needs-human` naming the sealed criterion and the conflicting task
- [ ] A test asserts an uncited sealed criterion receives a conflict claim over every plan task
- [ ] A test asserts the extraction-empty stories file and the no-`Done when` plan record conflict claims `not-applicable` without a refusal
- [ ] A test asserts a `conflicts` verdict on a post-reseal re-run reopens no task and appends no task even when a changed coverage claim cites a completed task
- [ ] A test asserts conflict entries absent from a prior envelope never reopen a completed task

## Story 2: A task that contradicts an approved ADR decision the plan is subject to halts before any build task, at every tier

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D21

As the daemon operator, I want `coverage_binding` to refuse a plan when a task requires something an approved ADR decision it is subject to forbids, including at tier S, so that ADR conflicts stop before BUILD instead of becoming as-built `DESIGN` halts.

### Acceptance Criteria

#### Happy Path
- Given a tier S plan whose text cites an approved ADR stem and whose Tasks 7 to 10 require assertions of generated values through the HTTP endpoint, and that ADR's decision 4 says generated-value properties are not asserted through the endpoint, when `coverage_binding` runs with the judge enabled, then a conflict claim for that ADR's decision 4 is judged against every plan task
- Given the judge returns `conflicts` naming Tasks 7 to 10 for that decision, when the step completes, then it refuses `needs-human` naming the decision as `<stem>#D4` and naming Tasks 7, 8, 9, and 10
- Given a tier S plan whose Task 6 requires pinning a YAML enum list and transcribing registry tuples, and two cited approved ADRs whose decisions forbid the enum pin and forbid transcribing a roster, when the judge returns `conflicts` naming Task 6 for each decision, then the refusal names both decisions and Task 6
- Given a plan-cited approved ADR whose `## Decision` section has no citable decision ids, when conflict claims are assembled, then exactly one claim carries that ADR's whole `## Decision` text and a conflict on it is named `<stem>#Decision`
- Given an ADR that the branch adds or modifies and the plan does not cite, when conflict claims are assembled, then that ADR's decisions are judged as subject decisions
- Given a plan-cited ADR whose status reads `SUPERSEDED in part by` another ADR, when conflict claims are assembled, then its remaining decisions receive conflict claims
- Given a plan-cited ADR whose status line reads `**Status:** Approved` in mixed case, when conflict claims are assembled, then its decisions receive conflict claims
- Given a subject ADR in which one decision id labels two passages, when conflict claims are assembled, then one claim carries both passages under that id

#### Negative Paths
- Given the plan text cites an ADR stem whose status is DRAFT, when conflict claims are assembled, then no conflict claim is created for that ADR
- Given the plan text cites an ADR stem whose status is a full supersession by another ADR, when conflict claims are assembled, then no conflict claim is created for that ADR
- Given a plan-cited approved ADR with no `## Decision` section, when `coverage_binding` runs, then its conflict claims are recorded `not-applicable` and the step does not fail
- Given a subject ADR amended on this branch whose amendment block introduces a new decision, when conflict claims are assembled, then that new decision receives no conflict claim and is judged only as an amendment claim
- Given the plan text names an ADR stem that has no matching decision-record file, when conflict claims are assembled, then no claim is created for it and the step does not fail on the missing file
- Given an approved ADR that the plan does not cite and the branch does not change, when conflict claims are assembled, then no conflict claim is created for its decisions

### Done When
- [ ] Fixtures reproducing the three ADR conflicts from the #2750 comment at tier S assert each decision's conflict claim reaches the judge with the conflicting task's `Done when` checks and that a stubbed `conflicts` verdict refuses `needs-human` naming the decision and the task
- [ ] A test asserts a bare ADR yields one `<stem>#Decision` claim
- [ ] A test asserts DRAFT, fully superseded, missing, and uncited-unchanged ADRs yield no conflict claim, and a partially superseded or mixed-case approved ADR yields claims
- [ ] A test asserts an ADR with no `## Decision` section records `not-applicable` without failing the step
- [ ] A test asserts a branch amendment's new decision yields an amendment claim and no conflict claim

## Story 3: A plan whose tasks merely cover different criteria lands and builds with no new refusal

**Requirement:** adr-2026-08-22-one-owner-per-review-question D1

As a spec author, I want a plan with no contradiction to pass `coverage_binding` exactly as before, so that the new question adds no false refusals and no new required artifact shape.

### Acceptance Criteria

#### Happy Path
- Given a plan whose tasks each cover a different sealed criterion and none requires an outcome another criterion or a subject ADR decision forbids, when the judge returns `consistent` for every conflict claim, then `coverage_binding` completes `done` and the first build task is dispatched
- Given a sealed criterion that no task covers, when the judge returns `consistent` for its conflict claim, then the conflict layer adds no refusal, and the coverage claims alone decide whether the step refuses
- Given a spec with zero criterion coverage claims on any carrier and every conflict claim `consistent`, when the step runs, then it completes `done` with no halt
- Given a rebase whose new base changes a plan-cited subject ADR and nothing else, when post-rebase invalidation is evaluated, then `coverage_binding` is re-run before the next build task
- Given a spec that passed `engineer land` before this change, when it is landed again after this change, then land accepts it with no new rejection, and no new plan or coherence section is required

#### Negative Paths
- Given `coverage_binding.judge.enabled` is false, when `coverage_binding` runs on a plan with a contradicting task, then every conflict claim is recorded `unjudged`, no judge is dispatched for them, and the step completes with the same status it had before this change
- Given an envelope written before this change with no conflict entries, when `coverage_binding` runs, then the absent entries are treated as cache misses and judged, and the envelope is not rejected as malformed

### Done When
- [ ] A fixture plan with disjoint, non-conflicting coverage and stubbed `consistent` verdicts completes `coverage_binding` `done` with no refusal
- [ ] A test asserts that with the judge disabled, conflict claims are recorded `unjudged` and no conflict batch is dispatched
- [ ] A test asserts an envelope with no conflict entries is read without error and its conflict claims are judged
- [ ] A test asserts `landSpec` accepts an existing passing fixture spec unchanged
- [ ] A test asserts a base change to a plan-cited subject ADR invalidates `coverage_binding` after rebase

## Story 4: Conflict verdicts are closed, validated, and cached by the full task table

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D22

As the daemon operator, I want a malformed or stale conflict verdict to be impossible to record, so that a refusal or a pass always reflects the current plan.

### Acceptance Criteria

#### Happy Path
- Given a batch of conflict claims, when the judge prompt is built, then the plan's task table appears once in the prompt and each claim carries its issued id, its kind as `criterion` or `adr-decision`, and its text
- Given a prior envelope holding a conflict verdict and an unchanged plan task table and claim text, when `coverage_binding` re-runs, then that claim is a cache hit and is not re-dispatched
- Given a prior envelope holding a `consistent` verdict, when any plan task's title or `Done when` checks change, then every conflict claim is re-judged
- Given a conflict claim whose text alone exceeds the batch prompt byte budget, when batches are formed, then that claim is dispatched in a batch of its own with its full text

#### Negative Paths
- Given the judge returns `conflicts` with a task id not in the plan, when the batch is parsed, then the whole batch is rejected as `CoverageBindingPayloadError` and no verdict from it is recorded
- Given the judge returns `conflicts` with an empty task id list or an empty conflict statement, when the batch is parsed, then the whole batch is rejected as `CoverageBindingPayloadError`
- Given the judge omits a claim id it was issued, or returns a claim id it was not issued, or returns one twice, when the batch is parsed, then the whole batch is rejected as `CoverageBindingPayloadError`
- Given the judge returns a verdict word other than `consistent` or `conflicts`, when the batch is parsed, then the whole batch is rejected as `CoverageBindingPayloadError`
- Given an earlier conflict batch in the same run was accepted and a later batch is rejected, when the envelope is checkpointed, then the earlier batch's verdicts remain recorded and the run's status is not `done`

### Done When
- [ ] A test asserts the conflict batch prompt contains the task table exactly once
- [ ] A test asserts a cache hit on an unchanged task table and claim, and re-judgement after a task's `Done when` changes
- [ ] Parser tests reject unknown task ids, empty `taskIds`, empty `conflict`, missing, foreign, and duplicate claim ids, and out-of-vocabulary verdicts as `CoverageBindingPayloadError`
- [ ] A test asserts an accepted batch survives a later rejected batch in the checkpointed envelope
- [ ] A test asserts an oversize claim is dispatched alone and untruncated

## Story 5: Every conflict judgement is observable on the event spine

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D24

As the daemon operator, I want each conflict claim's outcome persisted as an event, so that dashboards and post-mortems see conflict refusals without reading a sidecar file.

### Acceptance Criteria

#### Happy Path
- Given `coverage_binding` judges conflict claims, when each claim's verdict is recorded, then one `coverage_binding_conflict_judged` event per claim is persisted to `.pipeline/events.jsonl` with the claim kind, the verdict, and the conflicting task ids
- Given a conflict refusal, when the step ends, then the existing `step_refused` and `loop_halt` events record it and no conflict-specific halt event is emitted

#### Negative Paths
- Given the judge is disabled, when conflict claims are recorded `unjudged`, then each still emits `coverage_binding_conflict_judged` with verdict `unjudged`
- Given conflict claims are judged, when criterion and amendment claims are also judged in the same run, then `coverage_binding_judged` and `coverage_binding_amendment_judged` events carry only their existing verdict values

### Done When
- [ ] `coverage_binding_conflict_judged` is a `ConductorEvent` member declared in the exhaustive sink registry with persist enabled
- [ ] A runner test asserts one `coverage_binding_conflict_judged` event per conflict claim, including `unjudged` when disabled
- [ ] A test asserts the existing coverage and amendment events' verdict vocabularies are unchanged
