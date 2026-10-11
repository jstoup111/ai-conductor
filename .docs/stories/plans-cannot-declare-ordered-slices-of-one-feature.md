**Status:** Accepted

# Stories: Plans declare ordered slices of one feature (#2723)

Technical track. The criteria come from the desired outcomes of issue jstoup111/ai-conductor#2723
and from `adr-2026-09-29-plan-slice-manifest`. The slice manifest is a `## Slices` section holding
one table whose header row names the columns `Slice`, `Title` and `Tasks`, placed before the
plan's first task heading.

## Story 1: A project opts into stacked publication with one default-off config key

As an operator, I want one config key that enables stacked publication, so that a project opts in
deliberately and a typo is rejected instead of silently ignored.

### Acceptance Criteria

#### Happy Path
- Given a project config with no `stacked_prs` block, when the project config loads, then it loads without error and the loaded config carries no `stacked_prs` block, which is the off state
- Given a project config whose `stacked_prs` block is empty, when the project config loads, then it loads without error and `stacked_prs.enabled` is false
- Given a project config whose `stacked_prs` block sets `enabled` to true, when the project config loads, then it loads without error and `stacked_prs.enabled` is true
- Given the project config template shipped with the harness, when an operator reads it, then it contains a commented, inert `stacked_prs` entry with `enabled` set to false

#### Negative Paths
- Given a project config whose `stacked_prs` block sets `enabled` to the string "yes", when the project config loads, then loading fails with a validation error naming `stacked_prs.enabled`
- Given a project config whose `stacked_prs` block carries an unknown key `max_parallel`, when the project config loads, then loading fails with a validation error naming `max_parallel` as an unknown key in `stacked_prs`
- Given a project config whose `stacked_prs` value is the list `[true]`, when the project config loads, then loading fails with a validation error stating that `stacked_prs` must be an object
- Given the config consumer registry, when the registry test enumerates every accepted config key, then `stacked_prs`, `stacked_prs.enabled` and `stacked_prs.max_slices` are each declared with the land `stacked-delivery` rung and the `coverage_binding` runner as their production readers

### Done When
- [ ] `loadProjectConfig` accepts `stacked_prs.enabled` as a boolean, defaults it to false inside a present block, and rejects a non-object block, an unknown sub-key, and a non-boolean `enabled`, each with the offending key named in the error
- [ ] The config consumer registry declares `stacked_prs`, `stacked_prs.enabled` and `stacked_prs.max_slices` with land and `coverage_binding` as consumers, and the registry totality test passes
- [ ] `templates/project-config.yml.template` carries a commented `stacked_prs` entry that the config-template test accepts

## Story 2: Plans without slices, and sliced plans with the flag off, behave exactly as today

As an operator, I want nothing to change for any existing plan and for any project that has not
opted in, so that the grammar can land before any consumer of it exists.

### Acceptance Criteria

#### Happy Path
- Given a plan with no `## Slices` section whose tasks use free-form Dependencies prose such as "Tasks 1–9 all passing", when land runs, then no slice refusal is raised and the spec commits as it does today
- Given a plan with no `## Slices` section and `stacked_prs.enabled` set to true, when land runs, then no slice refusal is raised and the spec commits
- Given a plan with no `## Slices` section, when the `coverage_binding` step runs, then it records no slice membership, emits no slice event, and reaches the same completion status it reaches today
- Given a well-formed sliced plan and `stacked_prs.enabled` false, when land and then the `coverage_binding` step run, then both succeed, `coverage_binding` reads the flag only to leave its stacked-delivery layer inert, and no build, finish or publication step creates a child or reads the slice manifest (the BUILD child cursor reads the flag only to decide whether to create children, and creates none when it is false)

#### Negative Paths
- Given a malformed slice manifest, when land runs once with `stacked_prs.enabled` false and once with it true, then both runs refuse with the identical slice refusal message
- Given an unmarked plan (one without the plan-format marker of adr-2026-10-10-single-two-mode-plan-compiler) with no `## Slices` section but a `## Task Dependency Graph` section and no per-task Dependencies lines, when land runs, then no slice refusal is raised and the existing presence-only dependency check still accepts the plan
- Given a plan whose `## Slices` table appears only inside a fenced code block, when land runs, then the plan is treated as having no slices and no slice refusal is raised

### Done When
- [ ] A land test commits an unsliced plan carrying free-form Dependencies prose with the flag both on and off
- [ ] A `coverage_binding` runner test on an unsliced plan asserts no membership field is written and no `plan_slices_changed` event is emitted
- [ ] A test asserts the land slice refusal message is identical with `stacked_prs.enabled` true and false

## Story 3: A plan declares a small number of ordered, titled slices

As a plan author, I want to declare slices in one table naming each slice's order position, title
and tasks, so that the grouping is readable in one place and one move is one row edit.

### Acceptance Criteria

#### Happy Path
- Given a plan with eight tasks and a `## Slices` table before Task 1 with rows for slice 1 "Config flag" citing tasks 1, 2, 3, slice 2 "Land validation" citing tasks 4, 5, 6, and slice 3 "Re-validation" citing tasks 7, 8, when the slice validator runs, then it returns three slices in order 1, 2, 3 with those titles and task ids
- Given the same plan, when land runs, then the spec commits with no slice refusal
- Given a `Tasks` cell citing "4 (landed), 5", when the slice validator runs, then the cell resolves to tasks 4 and 5
- Given slices at positions 1, 3 and 7, when the slice validator runs, then it returns them in the order 1, 3, 7 with no violation
- Given a `Tasks` cell citing "2, 2, 3", when the slice validator runs, then the cell resolves to tasks 2 and 3 with no violation

#### Negative Paths
- Given a plan whose `## Slices` section appears after the heading of Task 1, when land runs, then land refuses and the refusal states that the Slices section must precede the first task
- Given a plan whose `## Slices` table header names the columns `Slice`, `Name` and `Tasks`, when land runs, then land refuses and the refusal states the required header columns `Slice`, `Title` and `Tasks`
- Given a slice row whose Title cell is empty, when land runs, then land refuses naming that slice position and the empty title
- Given a slice row whose Slice cell is "two", when land runs, then land refuses stating that a slice position must be a positive integer
- Given a plan with two `## Slices` sections, when land runs, then land refuses stating that a plan may declare at most one Slices section
- Given a `Tasks` cell citing "1,,2", when land runs, then land refuses naming that slice's Tasks cell as malformed

### Done When
- [ ] `validatePlanSlices` is exported from `src/conductor/src/engine/plan-slices.ts` and returns an unsliced, sliced or invalid result, where a sliced result lists slices by ascending position with title and resolved task ids
- [ ] Tests exercise each negative path above against `validatePlanSlices` and against the land gate on a real plan file
- [ ] The Tasks cell resolves through `resolvePlanTaskReference` and no second task-id regex exists in `plan-slices.ts`

## Story 4: Malformed slice membership is refused at land with the problem named

As an operator, I want every membership error refused before the spec lands, naming the task and
slice, so that a downstream stack can never be cut from an incomplete or ambiguous grouping.

### Acceptance Criteria

#### Happy Path
- Given a plan where every task appears in exactly one slice, when land runs, then no membership refusal is raised
- Given a sealed sliced plan to which the engine has appended remediation task `rem-build-review-1` in no slice, when the slice validator runs, then the remediation task raises no membership violation

#### Negative Paths
- Given an unmarked sliced plan whose Task 6 appears in no slice, when land runs, then land refuses with the `plan-slices` refusal naming Task 6 as in no slice
- Given a sliced plan whose Task 3 is cited by slice 1 and slice 2, when land runs, then land refuses naming Task 3 and both slice positions
- Given a sliced plan whose slice 2 row cites no tasks, when land runs, then land refuses naming slice 2 as empty
- Given a sliced plan with two rows both at position 2, when land runs, then land refuses naming duplicate slice position 2
- Given a sliced plan whose slice 1 cites task 12 and the plan has no Task 12 heading, when land runs, then land refuses naming task 12 as an unknown task id
- Given a Small-tier spec whose sliced plan leaves Task 2 in no slice, when land runs, then land refuses exactly as it would for a Medium-tier spec
- Given a sliced plan with Task 6 in no slice and Task 3 in two slices, when land runs, then one refusal names both violations rather than only the first
- Given an unmarked sliced plan with Task 6 in no slice and a coherence waiver line naming that defect, when land runs, then land still refuses with the `plan-slices` refusal

### Done When
- [ ] `LandGateIdentifier` includes `plan-slices`, and `landSpec` throws it for every invalid slice result
- [ ] One test per membership violation asserts the land refusal names the task id or slice position involved
- [ ] A test asserts a `rem-` prefixed task outside every slice raises no violation

## Story 5: No task depends on a task in a later slice

As an operator, I want a task that depends on work from a later slice refused, so that each slice's
checkpoint can build and test on its own.

### Acceptance Criteria

#### Happy Path
- Given a sliced plan where Task 5 in slice 2 carries a Dependencies line "Task 2, Task 4" and Tasks 2 and 4 are in slices 1 and 2, when land runs, then no dependency refusal is raised
- Given a sliced plan where a task's Dependencies line is "none", when land runs, then that task raises no dependency violation
- Given a sliced plan where a Dependencies line reads "Tasks 1, 3 (schema exists)", when the slice validator runs, then it resolves the dependencies to tasks 1 and 3

#### Negative Paths
- Given a sliced plan where Task 2 in slice 1 carries a Dependencies line "Task 7" and Task 7 is in slice 3, when land runs, then land refuses naming Task 2, Task 7, slice 1 and slice 3
- Given a sliced plan where a task's Dependencies line reads "Tasks 1–5", when land runs, then land refuses naming that task and listing the accepted Dependencies forms
- Given a sliced plan where a task's Dependencies line reads "all prior.", when land runs, then land refuses naming that task and listing the accepted Dependencies forms
- Given a sliced plan where Task 4 has no Dependencies line, when land runs, then land refuses naming Task 4 as missing its Dependencies line
- Given a sliced plan where Task 3's Dependencies line cites task 20 and no Task 20 exists, when land runs, then land refuses naming task 20 as an unknown dependency of Task 3

### Done When
- [ ] The strict Dependencies parser runs only when the plan declares slices, and resolves each reference through `resolvePlanTaskReference`
- [ ] A test asserts a later-slice dependency is refused naming both tasks and both slice positions
- [ ] A test asserts the range form, the prose form and a missing line are each refused with the accepted forms listed

## Story 6: The number of slices is bounded

As an operator, I want a plan limited to a small number of slices, so that a large plan becomes a
few reviewable PRs rather than one PR per task.

### Acceptance Criteria

#### Happy Path
- Given a well-formed sliced plan declaring exactly nine slices, when land runs with `stacked_prs.enabled` false, then no bound refusal is raised
- Given a well-formed sliced plan declaring one slice that holds every task, when land runs, then no slice refusal is raised

#### Negative Paths
- Given a sliced plan declaring ten otherwise well-formed slices, when land runs, then land refuses stating the plan declares 10 slices and the bound is 9
- Given a sliced plan declaring ten slices where one slice is also empty, when land runs, then one refusal names both the bound and the empty slice

### Done When
- [ ] The grammar bound in `plan-slices.ts` equals `MAX_CHILD_ID` (9), is flag-independent, and is not read from config; the configured `stacked_prs.max_slices` applies only to stacked delivery
- [ ] A test asserts a ten-slice plan is refused with the numbers 10 and 9 in the message

## Story 7: A slice change made by a DECIDE amendment is re-validated and visible

As an operator, I want a resealed plan amendment that changes slices to be re-checked before the
next build lap and reported on the event spine, so that slice membership is never silently
dropped or left invalid.

### Acceptance Criteria

#### Happy Path
- Given a sliced feature whose `coverage_binding` envelope recorded Task 4 in slice 1, when the plan is amended to move Task 4 into slice 2, resealed by the operator, and `coverage_binding` re-runs, then the step completes and a `plan_slices_changed` event names Task 4 as moved from slice 1 to slice 2
- Given the same amendment, when `coverage_binding` re-runs, then the envelope records Task 4 in slice 2
- Given a feature whose prior envelope recorded no slice membership, when `coverage_binding` runs on a sliced plan, then it records the membership and emits no `plan_slices_changed` event
- Given a sliced feature whose recorded membership already matches the plan, when `coverage_binding` re-runs, then no `plan_slices_changed` event is emitted
- Given a sliced feature with the coverage-binding judge disabled, when `coverage_binding` runs, then the slice validation still runs before the judge-disabled exit

#### Negative Paths
- Given a sliced feature whose plan is amended to add Task 9 in no slice and resealed, when `coverage_binding` re-runs, then the step is refused as needs-human naming Task 9, appends no plan task, and does not route to `plan`
- Given a sliced feature whose recorded membership exists, when the plan is amended to remove its `## Slices` section and resealed, then `coverage_binding` completes and emits a `plan_slices_changed` event reporting the manifest dropped
- Given a sliced feature whose recorded membership exists, when the engine appends remediation task `rem-build-review-2` and `coverage_binding` re-runs, then no `plan_slices_changed` event is emitted and no slice refusal is raised
- Given a sliced feature whose envelope was invalidated by an operator reseal, when the invalidated envelope is read, then its recorded slice membership is still present and the envelope still does not count as completion evidence
- Given an unsliced feature whose plan is amended to add a `## Slices` section and resealed, when `coverage_binding` re-runs with a prior envelope that recorded no membership, then it records the membership and emits no `plan_slices_changed` event

### Done When
- [ ] The `coverage_binding` runner calls `validatePlanSlices` before its judge-disabled exit and refuses needs-human on an invalid result
- [ ] The coverage-binding envelope carries an optional slice-membership field that the reseal void keeps, and `COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged
- [ ] `plan_slices_changed` is a `ConductorEvent` member with an `EVENT_SINKS` row that persists it to `.pipeline/events.jsonl`
- [ ] Tests cover a move, a dropped manifest, a baseline run, a remediation re-run, and an invalid amendment

## Story 8: The plan skill states the slice grammar the engine enforces

As a plan author, I want the plan skill's slice guidance to be exactly what the validator accepts,
so that following the skill never produces a plan the land gate refuses.

### Acceptance Criteria

#### Happy Path
- Given the slice example in `skills/plan/SKILL.md`, when it is passed to the slice validator together with the task headings it cites, then the validator returns a sliced result with no violation

#### Negative Paths
- Given the slice example in `skills/plan/SKILL.md` edited to cite a task the example does not declare, when the drift test runs, then the test fails naming the unknown task id
- Given the slice example in `skills/plan/SKILL.md` edited to use a Dependencies range, when the drift test runs, then the test fails naming the refused Dependencies line

### Done When
- [ ] `skills/plan/SKILL.md` documents the `## Slices` table, the membership and later-slice rules, the accepted Dependencies forms for sliced plans, and the grammar bound of 9
- [ ] A test extracts the skill's slice example and asserts `validatePlanSlices` returns a sliced result
