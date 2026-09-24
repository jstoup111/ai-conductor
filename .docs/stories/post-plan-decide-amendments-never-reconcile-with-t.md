**Status:** Accepted

# Post-plan DECIDE amendments reconcile with the plan before any further build lap (#1700)

Track: technical (no PRD — acceptance criteria live here)
Tier: M
Governing decisions: `adr-2026-08-31-coverage-binding-judge-step` D16, D17, D18, D19, D20 and `adr-2026-09-06-reopened-task-resolution` decision 10 (amended 2026-09-23); architecture review conditions C1–C3.

## Story 1: An operator reseal that changes DECIDE content re-arms coverage_binding

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D16

As the daemon operator, I want a reseal that changes a feature's ADR, architecture review, PRD, stories, or plan to force `coverage_binding` to run again before any build task so that an amendment is reconciled with the plan at the next dispatch instead of laps later.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `coverage_binding` status is `done` and one completed build task, when the operator reseals the feature's ADR after changing its content, then `coverage_binding`'s persisted status and gate verdict are unsatisfied, `.pipeline/coverage-binding.json` has status `invalidated`, and a `coverage_binding_invalidated` event naming the ADR path is persisted to `.pipeline/events.jsonl`
- Given a void has been recorded, when the operator rewinds the feature to `build`, then `coverage_binding` runs before any build task is dispatched
- Given a void has been recorded, when the daemon re-dispatches or resumes the feature, then `coverage_binding` runs before any build task is dispatched

#### Negative Paths
- Given a feature whose `coverage_binding` status is `done`, when the operator reseals a path whose new fingerprint equals its prior fingerprint, then `coverage_binding` stays `done` and no `coverage_binding_invalidated` event is emitted
- Given a feature whose `coverage_binding` status is `done`, when the operator reseals only a protected path outside the feature's DECIDE set, then `coverage_binding` stays `done` and no `coverage_binding_invalidated` event is emitted
- Given a void has been recorded, when the gate verdict for `coverage_binding` is read, then its origin is `decide-change` and the rebase-only reopen branch is not taken
- Given a void has been recorded and the envelope status is `invalidated`, when step completion is re-derived from artifacts, then `coverage_binding` is not reported done
- Given the per-attempt seal check reports a self-amendment on the feature's own plan and no reseal is run, when the step attempt proceeds, then `coverage_binding` stays `done` and dispatch is not blocked
- Given the reseal itself is refused, when the operator runs it, then `coverage_binding`'s status, verdict, and envelope are unchanged and no `coverage_binding_invalidated` event is emitted

### Done When
- [ ] A test reseals a changed ADR path on a feature with `coverage_binding` done and asserts the status and gate verdict read unsatisfied with origin `decide-change` and the envelope status is `invalidated`
- [ ] A test asserts a seal-reported self-amendment without a reseal leaves `coverage_binding` done
- [ ] A test asserts a byte-identical reseal, an out-of-set reseal, and a refused reseal each leave `coverage_binding` done with no invalidation event
- [ ] A loop test asserts that after a void, a rewind to `build` and a resume each dispatch `coverage_binding` before the first build task
- [ ] `coverage_binding_invalidated` is a `ConductorEvent` member declared in the exhaustive sink registry with persist enabled

## Story 2: A plan missing coverage for a current ADR decision halts before any build task

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D17

As the daemon operator, I want `coverage_binding` to reject a plan whose Architecture Obligation Coverage table lacks a row for a current ADR decision so that an ADR amended after plan approval is caught without a model call.

### Acceptance Criteria

#### Happy Path
- Given the feature's ADR carries decisions D1–D3 and the plan's `## Architecture Obligation Coverage` table has exactly one valid row for each, when `coverage_binding` runs, then the ADR layer records no violation and the step proceeds to its judged claims
- Given the feature's ADR is amended to add D4 and the plan has no D4 row, when `coverage_binding` runs, then the step is `refused` with kind `needs-human` and the halt names the ADR path, the decision id `D4`, and that the plan has no coverage row for it
- Given the judge is disabled by `coverage_binding.judge.enabled: false` and a required decision row is missing, when `coverage_binding` runs, then the step is still `refused` `needs-human` naming the missing decision with zero provider dispatches

#### Negative Paths
- Given a plan with no `## Architecture Obligation Coverage` section, when `coverage_binding` runs, then the ADR layer is recorded `not-applicable` and does not refuse the step
- Given a tier S feature, when `coverage_binding` runs, then the ADR layer is recorded `not-applicable`
- Given a cited ADR has no citable decision, when `coverage_binding` runs, then that ADR is recorded `not-applicable` and does not refuse the step
- Given the plan's obligation row for D2 cites a task whose `Done when` block does not contain the row's evidence text, when `coverage_binding` runs, then the step is refused naming the ADR path, `D2`, and that the evidence is absent from the cited task's `Done when`
- Given the plan's obligation table cites a decision id the ADR does not declare, when `coverage_binding` runs, then the step is refused naming the ADR path and the invented decision id
- Given an ADR in the DECIDE set cannot be read from disk, when `coverage_binding` runs, then the step fails as an infrastructure failure naming the unreadable path and does not record `done`

### Done When
- [ ] A step-runner test with an ADR amended to add D4 and no D4 plan row asserts `refused` / `needs-human` and a halt detail containing the ADR path and `D4`
- [ ] A step-runner test with the judge disabled asserts the same refusal with zero provider dispatches
- [ ] Tests assert a plan with no obligation section and an uncitable ADR each record `not-applicable` and the step completes
- [ ] The step uses `validateArchitectureObligationCoverage` and `parseAdrDecisions` for this layer; no second ADR parser is introduced

## Story 3: Amendment clauses are judged against the plan and block only when not carried

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D18

As the daemon operator, I want each `> **Amended …**` block in the feature's DECIDE artifacts judged against the plan's tasks so that an amendment the plan does not carry halts before a build lap, while one the plan already carries or that adds no plan work passes silently.

### Acceptance Criteria

#### Happy Path
- Given the architecture review carries one amendment block and the judge returns `carried` citing an issued task id, when `coverage_binding` runs, then the step completes `done` and a `coverage_binding_amendment_judged` event records verdict `carried`
- Given an ADR carries one amendment block and the judge returns `no-plan-obligation`, when `coverage_binding` runs, then the step completes `done` with no operator action
- Given an amendment block the judge returns `not-carried` with a `missingObligation`, when `coverage_binding` runs, then the step is `refused` `needs-human` and the halt names the artifact path, the amendment text, and the `missingObligation`
- Given an amendment block whose digest already carries `carried` in the previous envelope, when `coverage_binding` re-runs, then that claim is not dispatched to the judge

#### Negative Paths
- Given the judge returns `carried` with a task id that was not issued in the batch, when the payload is validated, then the whole batch is rejected as an infrastructure failure and no verdict from it is recorded
- Given the judge returns `not-carried` with an empty `missingObligation`, when the payload is validated, then the whole batch is rejected as an infrastructure failure
- Given the DECIDE set carries both criterion claims and amendment claims, when batches are planned, then no batch mixes the two claim kinds and every `coverage_binding_judged` event carries only `asserts`, `does-not-assert`, or `not-applicable`
- Given the judge is disabled and the DECIDE set carries an amendment block, when `coverage_binding` runs, then the claim is recorded `unjudged`, no provider is dispatched, and the amendment does not refuse the step
- Given the plan itself carries an amendment block, when claims are assembled, then no amendment claim is created from the plan

### Done When
- [ ] A step-runner test asserts `not-carried` refuses with the artifact path, amendment text, and `missingObligation` in the halt detail
- [ ] Tests assert `carried` and `no-plan-obligation` each complete the step `done`
- [ ] A test asserts a batch with a foreign task id or an empty `missingObligation` is rejected whole
- [ ] A test asserts criterion and amendment claims are never batched together
- [ ] `skills/coverage-binding/SKILL.md` states the amendment-claim contract and its three verdict values and the optional `contradictsCompleted` field

## Story 4: Completed work a DECIDE change contradicts is reopened, never re-planned

**Requirement:** adr-2026-08-31-coverage-binding-judge-step D19

As the daemon operator, I want tasks finished under the old contract reopened when a DECIDE change contradicts them so that code, tests, and docs already written are reconciled before the next paid review lap.

### Acceptance Criteria

#### Happy Path
- Given a void has been recorded, task 3 is completed, and the judge lists task 3 in an amendment claim's `contradictsCompleted`, when `coverage_binding` accepts the batch, then task 3 is restaged as open with a repair obligation whose source authority is `coverage_binding` and a `coverage_binding_task_reopened` event names task 3 and the claim digest
- Given a void has been recorded, task 2 is completed, and a criterion claim citing task 2 has a digest absent from the previous envelope's recorded digests, when `coverage_binding` runs, then task 2 is restaged as open without a model call
- Given reopened tasks exist, when the step completes, then the plan file is byte-identical to before the step, the step records no routing to `plan`, and the reopen is charged to `gates.coverage_binding`

#### Negative Paths
- Given coverage inputs changed through a rebase refresh and no void was recorded, when `coverage_binding` runs, then no task is reopened
- Given the previous envelope was written with the judge disabled or predates recorded digests, when `coverage_binding` runs after a void, then no criterion-digest reopen occurs and the new envelope records every current digest
- Given the judge lists a task id in `contradictsCompleted` that is not among the completed task ids issued in the batch, when the payload is validated, then the whole batch is rejected as an infrastructure failure and no task is reopened
- Given a criterion claim whose digest is unchanged from the previous envelope cites a completed task, when `coverage_binding` runs after a void, then that task stays completed
- Given the same reopen is admitted twice for the same plan, claim, and HEAD, when `coverage_binding` re-runs, then the repair obligation is replayed rather than duplicated and the task is restaged once

### Done When
- [ ] A step-runner test asserts a judged `contradictsCompleted` task is restaged open with a repair obligation whose source authority is `coverage_binding`
- [ ] A test asserts a changed-digest criterion claim reopens its completed cited task with zero provider dispatches after a void
- [ ] Tests assert a rebase refresh and a digest-less prior envelope each reopen nothing
- [ ] A test asserts a repeated admission replays the existing obligation and leaves one restage
- [ ] `coverage_binding_task_reopened` is a `ConductorEvent` member declared in the exhaustive sink registry
