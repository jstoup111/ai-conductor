**Status:** Accepted

# Stories: As-built review re-raises reworded findings as new obligations

Technical track (no PRD). Each story names the decision of
`adr-2026-10-28-as-built-finding-reconciliation` it delivers.

## Story 1: The gap planner sees every prior as-built case

**Requirement:** adr-2026-10-28-as-built-finding-reconciliation decision 2

As the remediation planner, I want every prior as-built case and its repair tasks in my input so that I can relate a current finding to its history.

### Acceptance Criteria

#### Happy Path
- Given a feature whose remediation case store holds two `as_built` cases, one `open` with an unresolved `rem-as-built-*` repair task and one `resolved` with a resolved repair task, when a BLOCKED as-built verdict contributes REMEDIABLE findings to a `gap-plan` dispatch, then the rendered projection lists both cases with their case id, status, recurrence count, every source's summary, typed reference, relation and reason, and each repair task id with its current resolution.
- Given a prior `as_built` case whose repair task is an appended `rem-as-built-*` task cited by no current finding, when the `gap-plan` projection is built, then that repair task appears in the projected task context with its title and Done-when checks alongside the owner tasks.
- Given a feature with no `as_built` cases in its store, when a BLOCKED as-built verdict contributes REMEDIABLE findings to a `gap-plan` dispatch, then the projection carries an empty prior-case list and the dispatch proceeds.

#### Negative Paths
- Given prior `as_built` cases whose rendered bytes exceed the projection's named limit, when the `gap-plan` projection is built, then no remediate dispatch runs, no case is dropped or truncated, and the feature halts `needs-human` with a preparation fault naming the prior-as-built-cases dimension, its actual size and its limit.
- Given a prior `as_built` case naming a repair task id that the active plan no longer declares, when the `gap-plan` projection is built, then no remediate dispatch runs and the feature halts `needs-human` with a preparation fault naming that task id.
- Given a remediation case store that is present but unreadable or malformed, when the `gap-plan` projection is built for an as-built verdict, then no remediate dispatch runs and the preparation fault names the store as unreadable instead of projecting an empty prior-case list.
- Given only a PRD-audit FIXABLE verdict and no as-built verdict in the round, when the `gap-plan` projection is built, then it carries no prior-as-built-cases section and, apart from its projection version, it is byte-identical to the same projection built without this feature.

### Done When
- [ ] A `gap-plan` projection test over a store with one `open` and one `resolved` `as_built` case asserts every listed field for both cases and both repair tasks in the task context
- [ ] A projection test over an oversize case set asserts the preparation fault's dimension, actual and limit values, and that no dispatch was made
- [ ] A projection test asserts the missing-repair-task fault names the undeclared task id
- [ ] A projection test over a PRD-audit-only round asserts no prior-as-built-cases section

## Story 2: Every as-built disposition carries a validated reconciliation result

**Requirement:** adr-2026-10-28-as-built-finding-reconciliation decision 3

As the engine, I want each as-built disposition in a gap plan to state how it relates to prior cases, with a reason, so that rewording can be recognized and every relation is checked before it takes effect.

### Acceptance Criteria

#### Happy Path
- Given a `gap-plan` projection with prior `as_built` case `c1`, when the planner returns one disposition per as-built finding, each with a `reconciliation` of relation `same`, `recurrence` or `materially-changed` naming `priorCaseId` `c1`, or relation `new` with no `priorCaseId`, each with a non-empty reason, then `validateRemediationPlan` accepts the plan and every accepted disposition retains its relation, prior case id and reason.
- Given a round with both PRD-audit FIXABLE criteria and as-built REMEDIABLE findings, when the planner answers the `prd-criterion` references without any `reconciliation` field, then those dispositions are accepted exactly as before this feature.
- Given two current as-built findings that restate one prior case, when both dispositions name the same `priorCaseId`, then the plan is accepted.

#### Negative Paths
- Given an as-built finding disposition with no `reconciliation` field, when the plan is validated, then it is rejected with a diagnostic naming that disposition's `reconciliation` field.
- Given an as-built finding disposition whose reconciliation reason is empty or whitespace, when the plan is validated, then it is rejected with a diagnostic naming the `reconciliation.reason` field.
- Given an as-built finding disposition with relation `same`, `recurrence` or `materially-changed` and either no `priorCaseId` or a `priorCaseId` that names no `as_built` case in the projection, when the plan is validated, then it is rejected with a diagnostic naming `reconciliation.priorCaseId` and the unknown id when one was given.
- Given an as-built finding disposition with relation `new` and a `priorCaseId`, when the plan is validated, then it is rejected with a diagnostic stating that `new` forbids a prior case id.
- Given an as-built finding disposition with a relation outside `same`, `recurrence`, `materially-changed` and `new`, when the plan is validated, then it is rejected with a diagnostic naming the closed relation set.
- Given a `prd-criterion` disposition that carries a `reconciliation` field, when the plan is validated, then it is rejected with a diagnostic stating that reconciliation applies only to as-built findings.
- Given the planner returns a reconciliation-invalid plan on every attempt, when remediate's existing retry allowance is exhausted, then the round takes the existing no-plan handling, no task is appended, no case is recorded, and the last rejection's diagnostics remain visible in the halt.

### Done When
- [ ] `validateRemediationPlan` unit tests cover acceptance of all four relations and every rejection diagnostic listed above
- [ ] `REMEDIATION_PLAN_SCHEMA` declares the `reconciliation` object with the closed relation enum, and a schema test asserts the rendered remediation-plan shape names it
- [ ] A mixed PRD-audit and as-built plan test asserts the `prd-criterion` dispositions validate unchanged
- [ ] A retry-exhaustion test asserts no append, no case write and the rejection diagnostics in the halt reason

## Story 3: A reworded or recurring finding binds its prior repair instead of minting a task

**Requirement:** adr-2026-10-28-as-built-finding-reconciliation decision 4

As an operator, I want a reworded or recurring as-built finding to reuse the repair already admitted for it so that rewording never grows the plan or mints a new remediation task.

### Acceptance Criteria

#### Happy Path
- Given prior `open` case `c1` with unresolved repair task `rem-as-built-t1` and a current ADR-cited finding reconciled `same` to `c1` with an `existing-task` disposition binding `rem-as-built-t1`, when the plan is admitted, then no plan task is appended, the shared growth count is unchanged, `rem-as-built-t1` is `pending` in task-status, and the round charges only the as-built gate's lap.
- Given prior `resolved` case `c1` whose repair task `rem-as-built-t1` is resolved and a current finding reconciled `recurrence` to `c1` with an `existing-task` disposition binding `rem-as-built-t1`, when the plan is admitted, then no plan task is appended, `rem-as-built-t1` is restaged `pending`, the shared growth count is unchanged, and case `c1` becomes `open` with its recurrence count increased by one.
- Given a current finding that cites plan task `4` and is reconciled `recurrence` to case `c1` with repair task `rem-as-built-t1`, when its `existing-task` disposition binds both `4` and `rem-as-built-t1`, then the plan is accepted and both tasks are restaged `pending`.
- Given a current finding reconciled `same` or `recurrence` with a `halt` disposition, when the plan is admitted, then the existing planner-halt path runs and no task is appended or restaged.

#### Negative Paths
- Given a finding reconciled `same` or `recurrence` with an appending disposition, when the plan is validated, then it is rejected with a diagnostic stating that the relation admits only `existing-task` or `halt`.
- Given a finding reconciled `same` or `recurrence` to case `c1` whose `existing-task` binding names none of `c1`'s repair tasks, when the plan is validated, then it is rejected with a diagnostic naming `c1` and its repair task ids.
- Given a finding that cites plan task `4` and is reconciled `recurrence` to case `c1`, when its binding names `rem-as-built-t1` but omits task `4`, then the plan is rejected with a diagnostic naming owner task `4`.
- Given a finding reconciled `recurrence` to case `c1`, when its binding also names an active task that is neither its owner nor a repair task of `c1`, then the plan is rejected with a diagnostic naming that non-owner task id.
- Given an admitted `same` or `recurrence` binding whose restage of a bound task to `pending` fails, when the round would dispatch BUILD, then it halts instead of dispatching, and no case is updated for that round.
- Given a recurrence round at the as-built gate's tier lap cap, when its BUILD dispatch settles the lap, then the existing `kickback-cap` halt is written naming the tier and allowance, and no separate recurrence-limit halt exists.

### Done When
- [ ] A `planRemediation` test for `same` asserts no appended block in the plan file, an unchanged `growth.byGate` count, the bound task `pending`, and a lap-only pending repair
- [ ] A `planRemediation` test for `recurrence` asserts the restaged repair task, an unchanged growth count, and case `c1` `open` with its recurrence count incremented in `.pipeline/remediation-cases.json`
- [ ] Validator tests assert each binding rejection diagnostic listed above
- [ ] A lap-cap test asserts the `kickback-cap` halt text names the tier allowance after recurrence rounds

## Story 4: Materially changed and new findings keep today's repair accounting

**Requirement:** adr-2026-10-28-as-built-finding-reconciliation decision 4

As an operator, I want a genuinely different or first-seen finding to be repaired exactly as today so that reconciliation never hides new work.

### Acceptance Criteria

#### Happy Path
- Given a current finding reconciled `materially-changed` to prior case `c1` with an appending disposition, when the plan is admitted, then one `rem-as-built-*` task is appended, its pending repair receipt draws one unit of shared growth that is charged when its BUILD dispatch settles, and a new case records `changedFrom` `c1` with the appended task as its repair.
- Given a current finding reconciled `new` with an appending or owner `existing-task` disposition, when the plan is admitted, then the append or binding behaves as before this feature, and a new case records that finding with its repair task ids.

#### Negative Paths
- Given a `materially-changed` or `new` appending disposition whose append would exceed the shared plan-growth allowance, when its BUILD dispatch settles, then the existing `kickback-cap` halt is written, exactly as for an appending disposition before this feature.
- Given a finding reconciled `new` that cites plan task `4`, when its `existing-task` binding names a repair task of an unrelated prior case instead of task `4`, then the plan is rejected with the existing owner-binding diagnostic naming task `4`.

### Done When
- [ ] A `planRemediation` test for `materially-changed` asserts one appended block, a growth count increased by one, and a new case with `changedFrom`
- [ ] A `planRemediation` test for `new` asserts unchanged append behavior and a new case recording the finding and repair task
- [ ] A validator test asserts the owner-binding rejection for a `new` finding binding another case's repair task

## Story 5: Reconciliation never changes as-built authority

**Requirement:** adr-2026-10-28-as-built-finding-reconciliation decision 5

As an operator, I want the as-built gate to pass only on a fresh approving verdict so that reconciliation history can never approve shipped code.

### Acceptance Criteria

#### Happy Path
- Given a lap in which every finding was reconciled `same` or `recurrence` and the bound repairs were rebuilt, when as-built review next returns `APPROVED`, then the gate is done, and every `open` `as_built` case becomes `resolved` in the same step that projects pending findings today.
- Given a lap in which every finding was reconciled `same` or `recurrence`, when as-built review next returns `BLOCKED`, then the gate is not done and the BLOCKED verdict routes exactly as a BLOCKED verdict with no prior cases would.

#### Negative Paths
- Given every current finding matches a `resolved` `as_built` case, when as-built review returns `BLOCKED`, then the gate is not done and the verdict is not converted, suppressed or marked approved.
- Given the store holds build_review cases, including operator-accepted ones, and PRD widening records, when the as-built verdict is routed or reconciled, then none of those records appears in the as-built prior-case projection and none changes the as-built gate outcome.
- Given an as-built verdict of a prior contract version, when the as-built gate is evaluated, then it is not authoritative and reruns as before this feature, and no case is created or resolved from it.

### Done When
- [ ] A gate test asserts an `APPROVED` verdict after reconciled laps marks the gate done and sets every `open` `as_built` case `resolved`
- [ ] A gate test asserts a `BLOCKED` verdict whose findings all match resolved cases leaves the gate not done
- [ ] A projection test over a store holding build_review and prd_widening records asserts none of them is projected as an as-built prior case

## Story 6: Every as-built finding is traceable to its reconciliation result

**Requirement:** adr-2026-10-28-as-built-finding-reconciliation decisions 6 and 7

As an operator, I want every as-built finding recorded with its relation and reason, including findings that halt for a human, so that I can see why each one did or did not create work.

### Acceptance Criteria

#### Happy Path
- Given an admitted gap plan reconciling three as-built findings as `same`, `materially-changed` and `new`, when the round's append or binding succeeds, then the store records each finding id as a source with its relation, reason and attempt, and `.pipeline/events.jsonl` holds one `as_built_finding_reconciled` event per finding carrying the finding id, case id, attempt, outcome, `priorCaseId` when present, and reason.
- Given a BLOCKED as-built verdict that carries one DESIGN and one REMEDIABLE finding, when the existing `needs-human` halt is written, then before the halt both findings are recorded as sources of new cases with status `needs-human`, and one `as_built_finding_reconciled` event with outcome `needs-human` is persisted per finding.
- Given an as-built finding the planner answers with `halt`, when the planner-halt path runs, then that finding is recorded with status `needs-human` and its event is persisted.
- Given a `resolved` case from an earlier gate pass, when a later as-built run on the same feature contributes findings to a `gap-plan` dispatch, then that resolved case is still listed in the projection.
- Given a feature whose case store is at an earlier envelope version holding build_review cases and PRD widening records, when its first as-built finding is recorded, then the store is upgraded to the current version with every existing record, suppression and pending outbox entry unchanged and the new as-built case added.

#### Negative Paths
- Given a gap plan that is rejected or never produced, when the round ends, then no `as_built` case is created or changed and no `as_built_finding_reconciled` event is emitted for that round.
- Given an admitted gap plan whose append or binding fails, when the round ends, then no case records the round's findings as admitted and no reconciliation event claims them.
- Given the case store write fails after a successful append or binding, when the round would dispatch BUILD, then the feature halts `needs-human` naming the store write fault and BUILD is not dispatched.
- Given the same admitted round is replayed after a process restart, when its cases are recorded again, then each finding id appears once as a source and no duplicate event claims a new case.
- Given the process stops after a recording is written but before its events are delivered, when the engine next drains the case store, then each pending `as_built_finding_reconciled` event is delivered with its original event id and the spine holds it exactly once.
- Given two validation-group members finish concurrently, when the as-built round records cases while another domain writes the store, then both writes are serialized by the store's existing lease and neither domain's records are lost.

### Done When
- [ ] A `planRemediation` test asserts one source per finding with relation, reason and attempt in `.pipeline/remediation-cases.json`, and one `as_built_finding_reconciled` line per finding in `.pipeline/events.jsonl`
- [ ] A DESIGN-halt test asserts `needs-human` cases and events exist before the HALT file is written
- [ ] A store-write-failure test asserts the `needs-human` halt names the store fault and no BUILD dispatch occurs
- [ ] A replay test asserts no duplicate source or new-case event after re-recording the same round
- [ ] The `ConductorEvent` union declares `as_built_finding_reconciled`, and the event persister writes it
