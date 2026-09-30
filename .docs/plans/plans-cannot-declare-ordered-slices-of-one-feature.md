# Implementation Plan: Plans declare ordered slices of one feature for stacked publication (#2723)

**Date:** 2026-09-29
**Design:** .docs/decisions/architecture-review-plans-cannot-declare-ordered-slices-of-one-feature.md
**Stories:** .docs/stories/plans-cannot-declare-ordered-slices-of-one-feature.md
**Conflict check:** Clean as of 2026-09-29

## Summary

14 tasks add an optional `## Slices` manifest to the plan grammar with one validator, `validatePlanSlices`, called from the engineer land gate and from `coverage_binding` after an amended plan is resealed, plus a default-off `stacked_prs.enabled` config key that nothing reads yet (#2724 is its first reader).

## Technical Approach

- **One owner (ADR D2).** New `src/conductor/src/engine/plan-slices.ts` exports `validatePlanSlices(planText)` returning `unsliced`, `sliced` (ordered slices with title and resolved task ids) or `invalid` (every violation, each with a code, optional slice position, optional task id, message). It is pure and model-free. Task ids come from `TASK_HEADER_PATTERN`; every id reference resolves through `resolvePlanTaskReference` (adr-2026-08-30 D1). Fenced content is skipped the way `parsePlanTaskBodies` skips it.
- **Grammar (D1).** At most one `## Slices` section, outside fences and before the first task heading, holding one table with the header columns `Slice`, `Title`, `Tasks`. No section means `unsliced`, which is valid with the flag on or off.
- **Rules (D3, D4).** Every task not matched by `isEngineAppendedRemediationTaskId` sits in exactly one non-empty slice; positions are unique positive integers (gaps allowed); ids are known; at most `MAX_PLAN_SLICES` (5, a code constant). Only on the sliced path, each non-exempt task carries one `**Dependencies:**` line: `none`, or a comma list with an optional leading `Task`/`Tasks` word per segment and optional parenthetical annotation; ranges and prose are refused because an H9 id may contain a hyphen. A dependency on a later slice is refused. Unsliced plans keep the presence-only `planHasDependencyTree` check; daemon discovery is unchanged.
- **Land rung (D5).** `landSpec` calls the validator right after the task-count rung and throws the new `plan-slices` gate id naming every violation, at every tier, without reading `stacked_prs.enabled`. Non-waivable: it runs before the coherence gate and no waiver parser accepts its ids.
- **Re-validation (D6, D7).** The `coverage_binding` runner calls the same validator beside the D17 ADR-obligation layer, before the judge-disabled exit, at every tier; `invalid` refuses needs-human with no task append and no plan routing. It records engine-computed membership (task id to slice position, plus ordered titles, excluding remediation ids) as an optional `sliceMembership` envelope field, which the reseal void keeps through its existing envelope spread and which is never completion evidence. When the prior envelope recorded membership and it differs, the runner emits the new `plan_slices_changed` event (persisted, not audited, not otel); a prior envelope without the field is a baseline (coverage-binding D19).
- **Config (D8).** `stacked_prs: { enabled }` validated like `mergeable_autoresolve`; the consumer registry declares it `none` with a reason citing #2724; a commented entry goes in `templates/project-config.yml.template`.
- **Skill (D9).** `skills/plan/SKILL.md` states the grammar with one fenced example that a drift test runs through the validator.
- **Sequencing.** Config (1-2), the envelope field (9) and the event (10) are independent. The validator core (3) precedes the land rung (4); the rule tasks (5-8) then extend `plan-slices.ts` in a chain so no two edit it concurrently, each owning its unit tests and its land fixtures in separate test files. The `coverage_binding` layer (11) needs the membership rule (6); membership recording (12) needs 9-11; the skill (13) needs the full rule set; the boundary test (14) closes over land and `coverage_binding`.

## Prerequisites

- `adr-2026-09-29-plan-slice-manifest` is APPROVED in this spec change set.
- #1700 (reseal void of `coverage_binding`) and #1744 (land story readability) are merged on main.

## Tasks

### Task 1: Validate the default-off `stacked_prs` config block
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stacked-prs-config.test.ts` for: no `stacked_prs` block (loads, block absent); an empty block (loads, `enabled` false); `enabled: true` (loads, true); `enabled: "yes"`, an unknown `max_slices` sub-key, and the list `[true]` (each a `validation_error` naming the key).
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/config.ts` and `src/conductor/src/types/config.ts`. Pattern: `validateMergeableAutoresolveBlock` and its `CONFIG_CONSUMER_KEY_SETS` entry; keep its traits (object-only, allow-list from the key set, boolean-only `enabled`, error names the offending key, default `enabled` to false inside a present block). Allowed variation: `stacked_prs` has only `enabled`. Add `stacked_prs` to the known top-level keys. Do not materialize a block when it is absent.
4. Verify the tests pass (GREEN).
5. Commit: "feat(config): default-off stacked_prs.enabled block"

**Done when:**
- `loadProjectConfig` in `src/conductor/src/engine/config.ts` loads a config with no `stacked_prs` block without error and returns a config whose `stacked_prs` is undefined, as asserted by the absent-block test in `src/conductor/test/engine/stacked-prs-config.test.ts`
- `loadProjectConfig` loads an empty `stacked_prs` block without error with `enabled` defaulted to false, and loads `enabled: true` without error as true, as asserted by the empty-block and enabled-true tests
- `loadProjectConfig` returns a `validation_error` whose message names `stacked_prs.enabled` for `enabled: "yes"`, names `max_slices` as an unknown key in `stacked_prs` for that sub-key, and states that `stacked_prs` must be an object for the list `[true]`, as asserted by three rejection tests
- `stacked_prs` is among the known top-level keys, `CONFIG_CONSUMER_KEY_SETS.stacked_prs` equals `['enabled']` in `config.ts`, and `HarnessConfig` in `src/conductor/src/types/config.ts` declares an optional `stacked_prs` block with a boolean `enabled`

**Files:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/src/types/config.ts`
- `src/conductor/test/engine/stacked-prs-config.test.ts`

**Dependencies:** none

### Task 2: Declare the reserved consumer and the template entry for `stacked_prs`
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing assertions: in `src/conductor/test/engine/config-consumer-registry.ts`, the registry totality test now requires `stacked_prs` and `stacked_prs.enabled`; in `src/conductor/test/engine/config-template.test.ts`, the project config template carries a commented `stacked_prs` entry with `enabled: false`.
2. Verify they fail (RED).
3. Implement: add both keys to `configConsumerRegistry` with `none('reserved for #2724 build-loop slice checkpoints; replaced by a real consumer when #2724 lands')`; add a commented, inert `stacked_prs` block to `templates/project-config.yml.template` beside the `mergeable_autoresolve` entry. Leave `templates/ai-conductor-config.yml.template` untouched.
4. Verify they pass (GREEN).
5. Commit: "feat(config): reserve stacked_prs consumer and template entry"

**Done when:**
- `configConsumerRegistry` in `src/conductor/test/engine/config-consumer-registry.ts` declares `stacked_prs` and `stacked_prs.enabled` each as a `none` consumer whose reason contains `#2724`, and the registry totality test passes with both keys accepted by the validator
- `templates/project-config.yml.template` carries a commented `stacked_prs:` entry with `enabled: false`, and a test in `src/conductor/test/engine/config-template.test.ts` asserts that commented entry is present and that the template's uncommented keys are unchanged

**Files:**
- `src/conductor/test/engine/config-consumer-registry.ts`
- `templates/project-config.yml.template`
- `src/conductor/test/engine/config-template.test.ts`

**Dependencies:** Task 1

### Task 3: Parse the `## Slices` manifest into ordered slices
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-slices.test.ts`: an unsliced plan and a plan whose only Slices table is fenced both return `unsliced`; the eight-task three-slice plan returns three ordered slices with titles and ids; annotated and repeated-id Tasks cells resolve; positions 1, 3, 7 order as 1, 3, 7. Author every sliced fixture that is meant to be valid so it also satisfies the rules Tasks 6-8 add later: each task in exactly one slice and each task carrying a `**Dependencies:**` line of `none` or ids from the same or an earlier slice.
2. Verify the tests fail (RED).
3. Implement `src/conductor/src/engine/plan-slices.ts`: export `validatePlanSlices(planText)` returning `{ kind: 'unsliced' }`, `{ kind: 'sliced', slices }` or `{ kind: 'invalid', violations }` (typed code, optional slice position, optional task id, message). Skip fenced content the way `parsePlanTaskBodies` does; read task ids through `TASK_HEADER_PATTERN`; resolve each Tasks cell with `resolvePlanTaskReference`. Order slices by position value.
4. Verify the tests pass (GREEN).
5. Commit: "feat(plan-slices): parse the Slices manifest"

**Done when:**
- `validatePlanSlices` exported from `src/conductor/src/engine/plan-slices.ts` returns `{ kind: 'unsliced' }` for a plan with no `## Slices` section and for a plan whose only `## Slices` table sits inside a fenced code block, as asserted in `src/conductor/test/engine/plan-slices.test.ts`
- for an eight-task plan whose table rows are slice 1 "Config flag" citing tasks 1, 2, 3, slice 2 "Land validation" citing tasks 4, 5, 6 and slice 3 "Re-validation" citing tasks 7, 8, `validatePlanSlices` returns `kind: 'sliced'` with slices in order 1, 2, 3 carrying exactly those titles and task ids, as asserted by the three-slice test
- `validatePlanSlices` resolves a Tasks cell "4 (landed), 5" to tasks 4 and 5 and a Tasks cell "2, 2, 3" to tasks 2 and 3 with no violation, by passing each cell to `resolvePlanTaskReference`, as asserted by the annotation and repeated-id tests
- `validatePlanSlices` returns slices declared at positions 1, 3 and 7 in the order 1, 3, 7 with no violation, as asserted by the position-gap test
- `plan-slices.ts` imports `TASK_HEADER_PATTERN` and `resolvePlanTaskReference` from `plan-task-parse.ts` for every task-id read and declares no task-id regular expression of its own

**Files:**
- `src/conductor/src/engine/plan-slices.ts`
- `src/conductor/test/engine/plan-slices.test.ts`

**Dependencies:** none

### Task 4: Add the `plan-slices` land rung
**Story:** 2
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/land-spec-plan-slices.test.ts` using the existing land-spec worktree fixtures: an unsliced plan with free-form Dependencies prose lands with the flag on and off; an unsliced plan with only a Task Dependency Graph section lands; a fenced-only Slices table lands; the eight-task three-slice plan lands; a stubbed invalid validator result throws gate `plan-slices`. Reuse the valid eight-task fixture from Task 3, which already satisfies the later membership and Dependencies rules.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/engineer/land-spec.ts`. Pattern: the `plan-done-when` and `plan-task-count` rungs (`validatePlanDoneWhen`, `validatePlanTaskCount`); keep their traits (pure validator in a sibling module, one `landGateError(<id>, …)` naming every violation, placement before the stories and coherence checks). Add `plan-slices` to `LandGateIdentifier`, call `validatePlanSlices(planContent)` right after the task-count check, and read no config and no tier for this rung.
4. Verify the tests pass (GREEN).
5. Commit: "feat(land): plan-slices land rung"

**Done when:**
- `LandGateIdentifier` in `src/conductor/src/engine/engineer/land-spec.ts` includes `plan-slices`, and `landSpec` calls `validatePlanSlices` on the plan text after the task-count check and throws `landGateError('plan-slices', …)` whose message contains every violation message of an invalid result, as asserted in `src/conductor/test/engine/engineer/land-spec-plan-slices.test.ts`
- a land test lands an unsliced plan whose tasks carry the Dependencies line "Tasks 1–9 all passing" once with `stacked_prs.enabled` false and once with it true, and asserts no `plan-slices` refusal is thrown and the spec commit is created both times
- a land test lands an unsliced plan that has a `## Task Dependency Graph` section and no per-task Dependencies lines, and asserts no `plan-slices` refusal is thrown and the spec commit is created
- a land test lands a plan whose only `## Slices` table is inside a fenced code block, and asserts no `plan-slices` refusal is thrown and the spec commit is created
- a land test lands the eight-task three-slice plan from the validator test and asserts the spec commit is created with no `plan-slices` refusal

**Files:**
- `src/conductor/src/engine/engineer/land-spec.ts`
- `src/conductor/test/engine/engineer/land-spec-plan-slices.test.ts`

**Dependencies:** Task 3

### Task 5: Refuse malformed manifest grammar
**Story:** 3
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-slices-grammar.test.ts` for the six grammar violations (placement after Task 1, wrong header columns, empty Title, Slice cell "two", two Slices sections, Tasks cell "1,,2"), and land tests in `src/conductor/test/engine/engineer/land-spec-plan-slices-grammar.test.ts` running `landSpec` on each fixture, plus the placement fixture with the flag false and true.
2. Verify the tests fail (RED).
3. Implement the grammar violations in `src/conductor/src/engine/plan-slices.ts`; each message states the accepted form (Slices before the first task heading, header columns `Slice`, `Title`, `Tasks`, positive-integer positions, non-empty titles, one section).
4. Verify the tests pass (GREEN).
5. Commit: "feat(plan-slices): refuse malformed manifest grammar"

**Done when:**
- `validatePlanSlices` returns an `invalid` result for a `## Slices` section after the Task 1 heading with a message stating that the Slices section must precede the first task, and for a table whose header names `Slice`, `Name` and `Tasks` with a message stating the required header columns `Slice`, `Title` and `Tasks`, as asserted in `src/conductor/test/engine/plan-slices-grammar.test.ts`
- `validatePlanSlices` returns an `invalid` result naming the slice position and the empty title for an empty Title cell, stating that a slice position must be a positive integer for a Slice cell "two", stating that a plan may declare at most one Slices section for two sections, and naming the slice's Tasks cell as malformed for "1,,2", as asserted by four grammar tests
- a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-grammar.test.ts` runs `landSpec` on each of the six grammar fixtures and asserts each throws `LandGateError` with gate `plan-slices` whose message contains that fixture's validator message, and that no spec commit is created
- a land test runs the placement fixture with `stacked_prs.enabled` false and again with it true, and asserts both runs refuse with gate `plan-slices` and identical refusal message strings

**Files:**
- `src/conductor/src/engine/plan-slices.ts`
- `src/conductor/test/engine/plan-slices-grammar.test.ts`
- `src/conductor/test/engine/engineer/land-spec-plan-slices-grammar.test.ts`

**Dependencies:** Task 4

### Task 6: Refuse incomplete or ambiguous slice membership
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-slices-membership.test.ts` (Task 6 in no slice, Task 3 in slices 1 and 2, empty slice 2, duplicate position 2, unknown task 12, the combined Task 6 plus Task 3 plan, a clean plan, and a `rem-build-review-1` task outside every slice) and land tests in `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts` (each fixture, a Small-tier worktree, and a worktree carrying a coherence waiver file naming the defect).
2. Verify the tests fail (RED).
3. Implement the membership rules in `src/conductor/src/engine/plan-slices.ts`: collect every violation before returning; exempt ids for which `isEngineAppendedRemediationTaskId` (from `remediation-append.ts`) is true; compare membership on resolved ids.
4. Verify the tests pass (GREEN).
5. Commit: "feat(plan-slices): refuse incomplete or ambiguous membership"

**Done when:**
- `validatePlanSlices` returns an `invalid` result naming Task 6 as in no slice, naming Task 3 with both slice positions 1 and 2 for a task in two slices, naming slice 2 as empty, naming duplicate slice position 2, and naming task 12 as an unknown task id, as asserted in `src/conductor/test/engine/plan-slices-membership.test.ts`
- `validatePlanSlices` returns one `invalid` result carrying both the in-no-slice violation for Task 6 and the two-slices violation for Task 3 when both occur in one plan, and raises no membership violation for a task heading whose id satisfies `isEngineAppendedRemediationTaskId`, as asserted by a test with `rem-build-review-1` outside every slice
- a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts` runs `landSpec` on the Task 6, Task 3, empty slice 2, duplicate position 2 and task 12 fixtures and asserts each throws gate `plan-slices` whose message contains that fixture's full validator message (in no slice, both slice positions 1 and 2, empty, duplicate position, unknown task id) and creates no commit, and that the combined Task 6 plus Task 3 fixture throws one refusal containing both validator messages
- a land test asserts a Small-tier worktree whose sliced plan leaves Task 2 in no slice throws gate `plan-slices` with a message identical to the refusal for the same plan in a Medium-tier worktree, and that a worktree with Task 6 in no slice plus a coherence waiver file whose Waives line names that defect still throws gate `plan-slices`
- a land test asserts a sliced plan with every task in exactly one slice lands with no membership refusal and the spec commit is created

**Files:**
- `src/conductor/src/engine/plan-slices.ts`
- `src/conductor/test/engine/plan-slices-membership.test.ts`
- `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts`

**Dependencies:** Task 5

### Task 7: Parse Dependencies strictly in sliced plans and refuse later-slice dependencies
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-slices-dependencies.test.ts` ("Task 2, Task 4", "none", "Tasks 1, 3 (schema exists)", Task 2 in slice 1 depending on Task 7 in slice 3, "Tasks 1–5", "all prior.", a missing line, an unknown task 20, and an unsliced plan carrying "all prior.") and land tests in `src/conductor/test/engine/engineer/land-spec-plan-slices-dependencies.test.ts`.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/plan-slices.ts`, only on the sliced path: read each non-exempt task's single `**Dependencies:**` line from `parsePlanTaskBodies`; accept `none` or a comma list, strip one leading `Task`/`Tasks` word per segment, then resolve with `resolvePlanTaskReference`; refuse ranges and prose with a message listing the accepted forms; compare slice positions.
4. Verify the tests pass (GREEN).
5. Commit: "feat(plan-slices): strict Dependencies and later-slice rule"

**Done when:**
- `validatePlanSlices` parses each `**Dependencies:**` line of a sliced plan as `none` or a comma list of references with an optional leading `Task` or `Tasks` word, resolving the list through `resolvePlanTaskReference`, and resolves "Tasks 1, 3 (schema exists)" to tasks 1 and 3, as asserted in `src/conductor/test/engine/plan-slices-dependencies.test.ts`
- `validatePlanSlices` returns an `invalid` result naming Task 2, Task 7, slice 1 and slice 3 when Task 2 in slice 1 depends on Task 7 in slice 3, and returns no violation when Task 5 in slice 2 depends on "Task 2, Task 4" held in slices 1 and 2 or when a Dependencies line is "none"
- `validatePlanSlices` returns an `invalid` result naming the task and listing the accepted Dependencies forms for the lines "Tasks 1–5" and "all prior.", naming Task 4 as missing its Dependencies line, and naming task 20 as an unknown dependency of Task 3
- a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-dependencies.test.ts` runs `landSpec` on the later-slice, range, prose, missing-line and unknown-dependency fixtures and asserts each throws gate `plan-slices` carrying the validator message, and asserts the "Task 2, Task 4" and "none" fixtures land with no dependency refusal
- `validatePlanSlices` never parses the Dependencies lines of a plan that has no `## Slices` section, as asserted by a test that an unsliced plan with the line "all prior." returns `unsliced`

**Files:**
- `src/conductor/src/engine/plan-slices.ts`
- `src/conductor/test/engine/plan-slices-dependencies.test.ts`
- `src/conductor/test/engine/engineer/land-spec-plan-slices-dependencies.test.ts`

**Dependencies:** Task 6

### Task 8: Bound the number of slices at five
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-slices-bound.test.ts` (five slices, one slice holding every task, six slices, six slices with one empty) and land tests in `src/conductor/test/engine/engineer/land-spec-plan-slices-bound.test.ts`.
2. Verify the tests fail (RED).
3. Implement `export const MAX_PLAN_SLICES = 5` in `src/conductor/src/engine/plan-slices.ts` and the bound violation, collected alongside the other violations.
4. Verify the tests pass (GREEN).
5. Commit: "feat(plan-slices): bound slices at five"

**Done when:**
- `MAX_PLAN_SLICES` is exported from `src/conductor/src/engine/plan-slices.ts` with the value 5 and `validatePlanSlices` takes no config argument, as asserted in `src/conductor/test/engine/plan-slices-bound.test.ts`
- `validatePlanSlices` returns an `invalid` result whose message states that the plan declares 6 slices and the bound is 5 for six well-formed slices, and returns one result naming both the bound and the empty slice when one of six slices is also empty
- a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-bound.test.ts` asserts the six-slice fixture throws gate `plan-slices` whose message contains the validator message stating that the plan declares 6 slices and the bound is 5, the six-with-an-empty-slice fixture's single refusal names the bound and the empty slice, and the five-slice fixture and the one-slice-holding-every-task fixture land with no slice refusal

**Files:**
- `src/conductor/src/engine/plan-slices.ts`
- `src/conductor/test/engine/plan-slices-bound.test.ts`
- `src/conductor/test/engine/engineer/land-spec-plan-slices-bound.test.ts`

**Dependencies:** Task 7

### Task 9: Carry slice membership in the coverage-binding envelope
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/coverage-binding-envelope.test.ts`, an envelope with a `sliceMembership` field round-trips and one without it still parses; in `src/conductor/test/engine/coverage-binding-void.test.ts`, the invalidated envelope keeps the prior field.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/coverage-binding-envelope.ts`. Pattern: the optional `adrLayer` field (`hasAdrLayer` and `exactKeys` in `parseCoverageBindingEnvelope`); keep its traits (optional key admitted only when present, strict shape parse, null on malformed). Leave `COVERAGE_BINDING_COMPLETION_STATUSES` unchanged. The void already spreads the prior envelope; assert that behavior rather than rewriting it.
4. Verify the tests pass (GREEN).
5. Commit: "feat(coverage-binding): slice membership envelope field"

**Done when:**
- `CoverageBindingEnvelope` in `src/conductor/src/engine/coverage-binding-envelope.ts` accepts an optional `sliceMembership` field mapping each task id to its slice position plus the ordered slice titles, `parseCoverageBindingEnvelope` round-trips it, and an envelope without it still parses, as asserted in `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `voidCoverageBindingForDecideChange` writes the invalidated envelope with the prior `sliceMembership` field unchanged, and `COVERAGE_BINDING_COMPLETION_STATUSES` still equals `['disabled', 'done']` so the invalidated envelope is not completion evidence, as asserted in `src/conductor/test/engine/coverage-binding-void.test.ts`

**Files:**
- `src/conductor/src/engine/coverage-binding-envelope.ts`
- `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `src/conductor/test/engine/coverage-binding-void.test.ts`

**Dependencies:** none

### Task 10: Add the `plan_slices_changed` event to the spine
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing tests: `src/conductor/test/engine/event-sinks.test.ts` expects the new row; `src/conductor/test/integration/audit-trail-completeness.integration.test.ts` classifies the event and supplies a sample.
2. Verify the tests fail (RED).
3. Implement: add the member to the `ConductorEvent` union in `src/conductor/src/types/events.ts` and its row to `EVENT_SINKS` in `src/conductor/src/engine/event-sinks.ts`. Pattern: the `coverage_binding_task_reopened` member and row.
4. Verify the tests pass (GREEN).
5. Commit: "feat(events): plan_slices_changed"

**Done when:**
- `ConductorEvent` in `src/conductor/src/types/events.ts` includes `plan_slices_changed` carrying `step`, `moved` entries of task id, from slice and to slice, `added` and `removed` task ids, and a `manifest` value of `unchanged` or `dropped`
- `EVENT_SINKS` in `src/conductor/src/engine/event-sinks.ts` declares `plan_slices_changed` as `{ render: false, persist: true, audit: false, otel: false }`, as asserted in `src/conductor/test/engine/event-sinks.test.ts`, and the audit-trail completeness test classifies it `not-audited-by-design`

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/engine/event-sinks.test.ts`
- `src/conductor/test/integration/audit-trail-completeness.integration.test.ts`

**Dependencies:** none

### Task 11: Re-validate slices in `coverage_binding` before the judge
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-slice-layer.test.ts` with the judge disabled: a sliced plan amended to add Task 9 in no slice; a sliced plan whose only out-of-slice task is `rem-build-review-2`.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/step-runners.ts`. Pattern: the D17 ADR-obligation layer (the `validateArchitectureObligationCoverage` call site in the `coverage_binding` runner); keep its traits (runs before the judge-enabled branch and the judge-disabled exit, refusal via `writeEnvelope('refused', [])` and a `{ kind: 'needs-human' }` refusal result naming each violation, engine-computed data only). Allowed variation: the slice layer runs at every tier. Never append a task and never route to `plan`.
4. Verify the tests pass (GREEN).
5. Commit: "feat(coverage-binding): slice layer re-validates amended plans"

**Done when:**
- the `coverage_binding` runner in `src/conductor/src/engine/step-runners.ts` calls `validatePlanSlices` on the resolved plan before its judge-disabled exit, as asserted in `src/conductor/test/engine/coverage-binding-slice-layer.test.ts` by a judge-disabled run whose sliced plan has a slice violation and is still refused
- for a sliced plan amended to add Task 9 in no slice, the runner returns a refusal of kind `needs-human` whose reason names Task 9, writes the envelope status `refused`, appends no plan task, and records no routing to `plan`, as asserted by the invalid-amendment test
- for a sliced plan whose only out-of-slice task is `rem-build-review-2`, the runner raises no slice refusal, as asserted by the remediation-append test

**Files:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/coverage-binding-slice-layer.test.ts`

**Dependencies:** Task 6

### Task 12: Record slice membership and emit `plan_slices_changed` on change
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-slice-membership.test.ts` seeding the prior envelope: Task 4 moved from slice 1 to slice 2; no prior membership (including an unsliced feature that gained a Slices section); unchanged membership; a dropped Slices section; a plan that only gained `rem-build-review-2`; an unsliced plan with no prior membership under a disabled judge.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/engine/step-runners.ts`: compute membership from the `sliced` result excluding exempt ids; pass it into every `writeEnvelope` call; read the prior envelope; emit `plan_slices_changed` through the runner's event emitter only when the prior envelope has `sliceMembership` and the two differ (a prior envelope without the field is a baseline, per coverage-binding D19).
4. Verify the tests pass (GREEN).
5. Commit: "feat(coverage-binding): record slice membership and emit changes"

**Done when:**
- the `coverage_binding` runner writes the engine-computed `sliceMembership` of a valid sliced plan into every envelope it writes, excluding ids that satisfy `isEngineAppendedRemediationTaskId`, as asserted in `src/conductor/test/engine/coverage-binding-slice-membership.test.ts`
- when the prior envelope recorded Task 4 in slice 1 and the resealed plan holds Task 4 in slice 2, the runner completes, emits one `plan_slices_changed` event whose `moved` names Task 4 from slice 1 to slice 2, and the new envelope records Task 4 in slice 2
- when the prior envelope has no `sliceMembership`, including an unsliced feature amended to add a `## Slices` section, the runner records the membership and emits no `plan_slices_changed` event, and when the recorded membership equals the plan's it emits no event
- when the prior envelope recorded membership and the resealed plan has no `## Slices` section, the runner completes and emits `plan_slices_changed` with `manifest` set to `dropped`, and when the plan only gained `rem-build-review-2` it emits no `plan_slices_changed` event
- for a plan with no `## Slices` section and no prior membership, the runner writes no `sliceMembership` field, emits no `plan_slices_changed` event, and writes envelope status `disabled` under a disabled judge, the status that path wrote before this change

**Files:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/coverage-binding-slice-membership.test.ts`

**Dependencies:** Task 9, Task 10, Task 11

### Task 13: State the slice grammar in the plan skill with a drift test
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write a failing test in `src/conductor/test/engine/plan-slices-skill-contract.test.ts`: an `assertSkillSliceExample(skillText)` helper extracts the fenced slice example from `skills/plan/SKILL.md`, passes it unfenced to `validatePlanSlices`, and throws the violation messages unless the result is `sliced`; the drift test calls it on the real skill; two mutation tests call it on the example edited to cite an undeclared task and to use "Tasks 1–3".
2. Verify the tests fail (RED).
3. Implement: add a slice section to `skills/plan/SKILL.md` (the `## Slices` table and its placement, the membership rule, the later-slice rule, the accepted Dependencies forms for sliced plans, the bound of 5) with one fenced example plan. Pattern: `src/conductor/test/engine/plan-task-count-skill-contract.test.ts`, which pins documented skill text to exported constants.
4. Verify the tests pass (GREEN).
5. Commit: "feat(plan-skill): document the slice manifest with a drift test"

**Done when:**
- `skills/plan/SKILL.md` contains a slice section with one fenced example plan carrying a `## Slices` table plus the task headings and Dependencies lines it cites, and states the membership rule, the later-slice rule, the accepted Dependencies forms and the bound of 5
- a test in `src/conductor/test/engine/plan-slices-skill-contract.test.ts` extracts that fenced example and asserts `validatePlanSlices` returns `kind: 'sliced'` with no violation
- `assertSkillSliceExample`, the helper the drift test calls, throws an error containing the unknown task id when given the example edited to cite an undeclared task, and an error containing the refused Dependencies line when given the example edited to "Tasks 1–3", as asserted by two mutation tests

**Files:**
- `skills/plan/SKILL.md`
- `src/conductor/test/engine/plan-slices-skill-contract.test.ts`

**Dependencies:** Task 8

### Task 14: Bound the slice consumers to land and `coverage_binding`
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write a test in `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts`: run `landSpec` and then the `coverage_binding` runner (judge disabled) on a well-formed sliced plan with `stacked_prs.enabled` false; scan production sources under `src/conductor/src` for importers of `plan-slices.ts` and references to `stacked_prs`.
2. Verify it fails before the consumers exist (RED), then passes once Tasks 1, 4 and 12 are in (GREEN).
3. Commit: "test(plan-slices): consumer boundary"

**Done when:**
- a test in `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` runs `landSpec` and then the `coverage_binding` runner on a well-formed sliced plan with `stacked_prs.enabled` false, and asserts the spec commit is created and the runner returns a successful result
- the same test file asserts the only production modules under `src/conductor/src` importing `plan-slices.ts` are `engine/engineer/land-spec.ts` and `engine/step-runners.ts`, that every reference in `engine/step-runners.ts` to any `plan-slices.ts` export sits inside the `coverage_binding` runner, that no production module other than `engine/plan-slices.ts` contains the `Slices` section heading literal, so no build, finish or publication step reads the manifest, and that the only production modules referencing `stacked_prs` are `engine/config.ts` and `types/config.ts`

**Files:**
- `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts`

**Dependencies:** Task 1, Task 4, Task 12

## Task Dependency Graph

```text
Task 1 ─▶ Task 2
Task 3 ─▶ Task 4 ─▶ Task 5 ─▶ Task 6 ─▶ Task 7 ─▶ Task 8 ─▶ Task 13
Task 6 ─▶ Task 11
Task 9, Task 10, Task 11 ─▶ Task 12
Task 1, Task 4, Task 12 ─▶ Task 14
```

## Integration Points

- After Task 4: `ai-conductor compose land` reaches `validatePlanSlices`; every later rule task proves its refusal through `landSpec`.
- After Task 11: an operator reseal of an amended plan re-runs the slice validator in `coverage_binding` before the next build lap.
- After Task 12: slice membership changes appear in `.pipeline/events.jsonl` as `plan_slices_changed`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a project config with no `stacked_prs` block, when the project config loads, then it loads without error and the loaded config carries no `stacked_prs` block, which is the off state | 1 | "`loadProjectConfig` in `src/conductor/src/engine/config.ts` loads a config with no `stacked_prs` block without error and returns a config whose `stacked_prs` is undefined, as asserted by the absent-block test in `src/conductor/test/engine/stacked-prs-config.test.ts`" | diff-local |
| Story 1 happy: Given a project config whose `stacked_prs` block is empty, when the project config loads, then it loads without error and `stacked_prs.enabled` is false | 1 | "`loadProjectConfig` loads an empty `stacked_prs` block without error with `enabled` defaulted to false, and loads `enabled: true` without error as true, as asserted by the empty-block and enabled-true tests" | diff-local |
| Story 1 happy: Given a project config whose `stacked_prs` block sets `enabled` to true, when the project config loads, then it loads without error and `stacked_prs.enabled` is true | 1 | "`loadProjectConfig` loads an empty `stacked_prs` block without error with `enabled` defaulted to false, and loads `enabled: true` without error as true, as asserted by the empty-block and enabled-true tests" | diff-local |
| Story 1 happy: Given the project config template shipped with the harness, when an operator reads it, then it contains a commented, inert `stacked_prs` entry with `enabled` set to false | 2 | "`templates/project-config.yml.template` carries a commented `stacked_prs:` entry with `enabled: false`, and a test in `src/conductor/test/engine/config-template.test.ts` asserts that commented entry is present and that the template's uncommented keys are unchanged" | diff-local |
| Story 1 negative: Given a project config whose `stacked_prs` block sets `enabled` to the string "yes", when the project config loads, then loading fails with a validation error naming `stacked_prs.enabled` | 1 | "`loadProjectConfig` returns a `validation_error` whose message names `stacked_prs.enabled` for `enabled: "yes"`, names `max_slices` as an unknown key in `stacked_prs` for that sub-key, and states that `stacked_prs` must be an object for the list `[true]`, as asserted by three rejection tests" | diff-local |
| Story 1 negative: Given a project config whose `stacked_prs` block carries an unknown key `max_slices`, when the project config loads, then loading fails with a validation error naming `max_slices` as an unknown key in `stacked_prs` | 1 | "`loadProjectConfig` returns a `validation_error` whose message names `stacked_prs.enabled` for `enabled: "yes"`, names `max_slices` as an unknown key in `stacked_prs` for that sub-key, and states that `stacked_prs` must be an object for the list `[true]`, as asserted by three rejection tests" | diff-local |
| Story 1 negative: Given a project config whose `stacked_prs` value is the list `[true]`, when the project config loads, then loading fails with a validation error stating that `stacked_prs` must be an object | 1 | "`loadProjectConfig` returns a `validation_error` whose message names `stacked_prs.enabled` for `enabled: "yes"`, names `max_slices` as an unknown key in `stacked_prs` for that sub-key, and states that `stacked_prs` must be an object for the list `[true]`, as asserted by three rejection tests" | diff-local |
| Story 1 negative: Given the config consumer registry, when the registry test enumerates every accepted config key, then `stacked_prs` and `stacked_prs.enabled` are each declared with no production reader and a reason naming #2724 | 2 | "`configConsumerRegistry` in `src/conductor/test/engine/config-consumer-registry.ts` declares `stacked_prs` and `stacked_prs.enabled` each as a `none` consumer whose reason contains `#2724`, and the registry totality test passes with both keys accepted by the validator" | diff-local |
| Story 2 happy: Given a plan with no `## Slices` section whose tasks use free-form Dependencies prose such as "Tasks 1–9 all passing", when land runs, then no slice refusal is raised and the spec commits as it does today | 4 | "a land test lands an unsliced plan whose tasks carry the Dependencies line "Tasks 1–9 all passing" once with `stacked_prs.enabled` false and once with it true, and asserts no `plan-slices` refusal is thrown and the spec commit is created both times" | diff-local |
| Story 2 happy: Given a plan with no `## Slices` section and `stacked_prs.enabled` set to true, when land runs, then no slice refusal is raised and the spec commits | 4 | "a land test lands an unsliced plan whose tasks carry the Dependencies line "Tasks 1–9 all passing" once with `stacked_prs.enabled` false and once with it true, and asserts no `plan-slices` refusal is thrown and the spec commit is created both times" | diff-local |
| Story 2 happy: Given a plan with no `## Slices` section, when the `coverage_binding` step runs, then it records no slice membership, emits no slice event, and reaches the same completion status it reaches today | 12 | "for a plan with no `## Slices` section and no prior membership, the runner writes no `sliceMembership` field, emits no `plan_slices_changed` event, and writes envelope status `disabled` under a disabled judge, the status that path wrote before this change" | diff-local |
| Story 2 happy: Given a well-formed sliced plan and `stacked_prs.enabled` false, when land and then the `coverage_binding` step run, then both succeed and no build, finish or publication step reads the slice manifest or the flag | 14 | "the same test file asserts the only production modules under `src/conductor/src` importing `plan-slices.ts` are `engine/engineer/land-spec.ts` and `engine/step-runners.ts`, that every reference in `engine/step-runners.ts` to any `plan-slices.ts` export sits inside the `coverage_binding` runner, that no production module other than `engine/plan-slices.ts` contains the `Slices` section heading literal, so no build, finish or publication step reads the manifest, and that the only production modules referencing `stacked_prs` are `engine/config.ts` and `types/config.ts`" | diff-local |
| Story 2 negative: Given a malformed slice manifest, when land runs once with `stacked_prs.enabled` false and once with it true, then both runs refuse with the identical slice refusal message | 5 | "a land test runs the placement fixture with `stacked_prs.enabled` false and again with it true, and asserts both runs refuse with gate `plan-slices` and identical refusal message strings" | diff-local |
| Story 2 negative: Given a plan with no `## Slices` section but a `## Task Dependency Graph` section and no per-task Dependencies lines, when land runs, then no slice refusal is raised and the existing presence-only dependency check still accepts the plan | 4 | "a land test lands an unsliced plan that has a `## Task Dependency Graph` section and no per-task Dependencies lines, and asserts no `plan-slices` refusal is thrown and the spec commit is created" | diff-local |
| Story 2 negative: Given a plan whose `## Slices` table appears only inside a fenced code block, when land runs, then the plan is treated as having no slices and no slice refusal is raised | 4, 3 | "a land test lands a plan whose only `## Slices` table is inside a fenced code block, and asserts no `plan-slices` refusal is thrown and the spec commit is created" | diff-local |
| Story 3 happy: Given a plan with eight tasks and a `## Slices` table before Task 1 with rows for slice 1 "Config flag" citing tasks 1, 2, 3, slice 2 "Land validation" citing tasks 4, 5, 6, and slice 3 "Re-validation" citing tasks 7, 8, when the slice validator runs, then it returns three slices in order 1, 2, 3 with those titles and task ids | 3 | "for an eight-task plan whose table rows are slice 1 "Config flag" citing tasks 1, 2, 3, slice 2 "Land validation" citing tasks 4, 5, 6 and slice 3 "Re-validation" citing tasks 7, 8, `validatePlanSlices` returns `kind: 'sliced'` with slices in order 1, 2, 3 carrying exactly those titles and task ids, as asserted by the three-slice test" | diff-local |
| Story 3 happy: Given the same plan, when land runs, then the spec commits with no slice refusal | 4 | "a land test lands the eight-task three-slice plan from the validator test and asserts the spec commit is created with no `plan-slices` refusal" | diff-local |
| Story 3 happy: Given a `Tasks` cell citing "4 (landed), 5", when the slice validator runs, then the cell resolves to tasks 4 and 5 | 3 | "`validatePlanSlices` resolves a Tasks cell "4 (landed), 5" to tasks 4 and 5 and a Tasks cell "2, 2, 3" to tasks 2 and 3 with no violation, by passing each cell to `resolvePlanTaskReference`, as asserted by the annotation and repeated-id tests" | diff-local |
| Story 3 happy: Given slices at positions 1, 3 and 7, when the slice validator runs, then it returns them in the order 1, 3, 7 with no violation | 3 | "`validatePlanSlices` returns slices declared at positions 1, 3 and 7 in the order 1, 3, 7 with no violation, as asserted by the position-gap test" | diff-local |
| Story 3 happy: Given a `Tasks` cell citing "2, 2, 3", when the slice validator runs, then the cell resolves to tasks 2 and 3 with no violation | 3 | "`validatePlanSlices` resolves a Tasks cell "4 (landed), 5" to tasks 4 and 5 and a Tasks cell "2, 2, 3" to tasks 2 and 3 with no violation, by passing each cell to `resolvePlanTaskReference`, as asserted by the annotation and repeated-id tests" | diff-local |
| Story 3 negative: Given a plan whose `## Slices` section appears after the heading of Task 1, when land runs, then land refuses and the refusal states that the Slices section must precede the first task | 5 | "`validatePlanSlices` returns an `invalid` result for a `## Slices` section after the Task 1 heading with a message stating that the Slices section must precede the first task, and for a table whose header names `Slice`, `Name` and `Tasks` with a message stating the required header columns `Slice`, `Title` and `Tasks`, as asserted in `src/conductor/test/engine/plan-slices-grammar.test.ts`" | diff-local |
| Story 3 negative: Given a plan whose `## Slices` table header names the columns `Slice`, `Name` and `Tasks`, when land runs, then land refuses and the refusal states the required header columns `Slice`, `Title` and `Tasks` | 5 | "`validatePlanSlices` returns an `invalid` result for a `## Slices` section after the Task 1 heading with a message stating that the Slices section must precede the first task, and for a table whose header names `Slice`, `Name` and `Tasks` with a message stating the required header columns `Slice`, `Title` and `Tasks`, as asserted in `src/conductor/test/engine/plan-slices-grammar.test.ts`" | diff-local |
| Story 3 negative: Given a slice row whose Title cell is empty, when land runs, then land refuses naming that slice position and the empty title | 5 | "`validatePlanSlices` returns an `invalid` result naming the slice position and the empty title for an empty Title cell, stating that a slice position must be a positive integer for a Slice cell "two", stating that a plan may declare at most one Slices section for two sections, and naming the slice's Tasks cell as malformed for "1,,2", as asserted by four grammar tests" | diff-local |
| Story 3 negative: Given a slice row whose Slice cell is "two", when land runs, then land refuses stating that a slice position must be a positive integer | 5 | "`validatePlanSlices` returns an `invalid` result naming the slice position and the empty title for an empty Title cell, stating that a slice position must be a positive integer for a Slice cell "two", stating that a plan may declare at most one Slices section for two sections, and naming the slice's Tasks cell as malformed for "1,,2", as asserted by four grammar tests" | diff-local |
| Story 3 negative: Given a plan with two `## Slices` sections, when land runs, then land refuses stating that a plan may declare at most one Slices section | 5 | "`validatePlanSlices` returns an `invalid` result naming the slice position and the empty title for an empty Title cell, stating that a slice position must be a positive integer for a Slice cell "two", stating that a plan may declare at most one Slices section for two sections, and naming the slice's Tasks cell as malformed for "1,,2", as asserted by four grammar tests" | diff-local |
| Story 3 negative: Given a `Tasks` cell citing "1,,2", when land runs, then land refuses naming that slice's Tasks cell as malformed | 5 | "`validatePlanSlices` returns an `invalid` result naming the slice position and the empty title for an empty Title cell, stating that a slice position must be a positive integer for a Slice cell "two", stating that a plan may declare at most one Slices section for two sections, and naming the slice's Tasks cell as malformed for "1,,2", as asserted by four grammar tests" | diff-local |
| Story 4 happy: Given a plan where every task appears in exactly one slice, when land runs, then no membership refusal is raised | 6 | "a land test asserts a sliced plan with every task in exactly one slice lands with no membership refusal and the spec commit is created" | diff-local |
| Story 4 happy: Given a sealed sliced plan to which the engine has appended remediation task `rem-build-review-1` in no slice, when the slice validator runs, then the remediation task raises no membership violation | 6 | "`validatePlanSlices` returns one `invalid` result carrying both the in-no-slice violation for Task 6 and the two-slices violation for Task 3 when both occur in one plan, and raises no membership violation for a task heading whose id satisfies `isEngineAppendedRemediationTaskId`, as asserted by a test with `rem-build-review-1` outside every slice" | diff-local |
| Story 4 negative: Given a sliced plan whose Task 6 appears in no slice, when land runs, then land refuses with the `plan-slices` refusal naming Task 6 as in no slice | 6 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts` runs `landSpec` on the Task 6, Task 3, empty slice 2, duplicate position 2 and task 12 fixtures and asserts each throws gate `plan-slices` whose message contains that fixture's full validator message (in no slice, both slice positions 1 and 2, empty, duplicate position, unknown task id) and creates no commit, and that the combined Task 6 plus Task 3 fixture throws one refusal containing both validator messages" | diff-local |
| Story 4 negative: Given a sliced plan whose Task 3 is cited by slice 1 and slice 2, when land runs, then land refuses naming Task 3 and both slice positions | 6 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts` runs `landSpec` on the Task 6, Task 3, empty slice 2, duplicate position 2 and task 12 fixtures and asserts each throws gate `plan-slices` whose message contains that fixture's full validator message (in no slice, both slice positions 1 and 2, empty, duplicate position, unknown task id) and creates no commit, and that the combined Task 6 plus Task 3 fixture throws one refusal containing both validator messages" | diff-local |
| Story 4 negative: Given a sliced plan whose slice 2 row cites no tasks, when land runs, then land refuses naming slice 2 as empty | 6 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts` runs `landSpec` on the Task 6, Task 3, empty slice 2, duplicate position 2 and task 12 fixtures and asserts each throws gate `plan-slices` whose message contains that fixture's full validator message (in no slice, both slice positions 1 and 2, empty, duplicate position, unknown task id) and creates no commit, and that the combined Task 6 plus Task 3 fixture throws one refusal containing both validator messages" | diff-local |
| Story 4 negative: Given a sliced plan with two rows both at position 2, when land runs, then land refuses naming duplicate slice position 2 | 6 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts` runs `landSpec` on the Task 6, Task 3, empty slice 2, duplicate position 2 and task 12 fixtures and asserts each throws gate `plan-slices` whose message contains that fixture's full validator message (in no slice, both slice positions 1 and 2, empty, duplicate position, unknown task id) and creates no commit, and that the combined Task 6 plus Task 3 fixture throws one refusal containing both validator messages" | diff-local |
| Story 4 negative: Given a sliced plan whose slice 1 cites task 12 and the plan has no Task 12 heading, when land runs, then land refuses naming task 12 as an unknown task id | 6 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts` runs `landSpec` on the Task 6, Task 3, empty slice 2, duplicate position 2 and task 12 fixtures and asserts each throws gate `plan-slices` whose message contains that fixture's full validator message (in no slice, both slice positions 1 and 2, empty, duplicate position, unknown task id) and creates no commit, and that the combined Task 6 plus Task 3 fixture throws one refusal containing both validator messages" | diff-local |
| Story 4 negative: Given a Small-tier spec whose sliced plan leaves Task 2 in no slice, when land runs, then land refuses exactly as it would for a Medium-tier spec | 6 | "a land test asserts a Small-tier worktree whose sliced plan leaves Task 2 in no slice throws gate `plan-slices` with a message identical to the refusal for the same plan in a Medium-tier worktree, and that a worktree with Task 6 in no slice plus a coherence waiver file whose Waives line names that defect still throws gate `plan-slices`" | diff-local |
| Story 4 negative: Given a sliced plan with Task 6 in no slice and Task 3 in two slices, when land runs, then one refusal names both violations rather than only the first | 6 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-membership.test.ts` runs `landSpec` on the Task 6, Task 3, empty slice 2, duplicate position 2 and task 12 fixtures and asserts each throws gate `plan-slices` whose message contains that fixture's full validator message (in no slice, both slice positions 1 and 2, empty, duplicate position, unknown task id) and creates no commit, and that the combined Task 6 plus Task 3 fixture throws one refusal containing both validator messages" | diff-local |
| Story 4 negative: Given a sliced plan with Task 6 in no slice and a coherence waiver line naming that defect, when land runs, then land still refuses with the `plan-slices` refusal | 6 | "a land test asserts a Small-tier worktree whose sliced plan leaves Task 2 in no slice throws gate `plan-slices` with a message identical to the refusal for the same plan in a Medium-tier worktree, and that a worktree with Task 6 in no slice plus a coherence waiver file whose Waives line names that defect still throws gate `plan-slices`" | diff-local |
| Story 5 happy: Given a sliced plan where Task 5 in slice 2 carries a Dependencies line "Task 2, Task 4" and Tasks 2 and 4 are in slices 1 and 2, when land runs, then no dependency refusal is raised | 7 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-dependencies.test.ts` runs `landSpec` on the later-slice, range, prose, missing-line and unknown-dependency fixtures and asserts each throws gate `plan-slices` carrying the validator message, and asserts the "Task 2, Task 4" and "none" fixtures land with no dependency refusal" | diff-local |
| Story 5 happy: Given a sliced plan where a task's Dependencies line is "none", when land runs, then that task raises no dependency violation | 7 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-dependencies.test.ts` runs `landSpec` on the later-slice, range, prose, missing-line and unknown-dependency fixtures and asserts each throws gate `plan-slices` carrying the validator message, and asserts the "Task 2, Task 4" and "none" fixtures land with no dependency refusal" | diff-local |
| Story 5 happy: Given a sliced plan where a Dependencies line reads "Tasks 1, 3 (schema exists)", when the slice validator runs, then it resolves the dependencies to tasks 1 and 3 | 7 | "`validatePlanSlices` parses each `**Dependencies:**` line of a sliced plan as `none` or a comma list of references with an optional leading `Task` or `Tasks` word, resolving the list through `resolvePlanTaskReference`, and resolves "Tasks 1, 3 (schema exists)" to tasks 1 and 3, as asserted in `src/conductor/test/engine/plan-slices-dependencies.test.ts`" | diff-local |
| Story 5 negative: Given a sliced plan where Task 2 in slice 1 carries a Dependencies line "Task 7" and Task 7 is in slice 3, when land runs, then land refuses naming Task 2, Task 7, slice 1 and slice 3 | 7 | "`validatePlanSlices` returns an `invalid` result naming Task 2, Task 7, slice 1 and slice 3 when Task 2 in slice 1 depends on Task 7 in slice 3, and returns no violation when Task 5 in slice 2 depends on "Task 2, Task 4" held in slices 1 and 2 or when a Dependencies line is "none"" | diff-local |
| Story 5 negative: Given a sliced plan where a task's Dependencies line reads "Tasks 1–5", when land runs, then land refuses naming that task and listing the accepted Dependencies forms | 7 | "`validatePlanSlices` returns an `invalid` result naming the task and listing the accepted Dependencies forms for the lines "Tasks 1–5" and "all prior.", naming Task 4 as missing its Dependencies line, and naming task 20 as an unknown dependency of Task 3" | diff-local |
| Story 5 negative: Given a sliced plan where a task's Dependencies line reads "all prior.", when land runs, then land refuses naming that task and listing the accepted Dependencies forms | 7 | "`validatePlanSlices` returns an `invalid` result naming the task and listing the accepted Dependencies forms for the lines "Tasks 1–5" and "all prior.", naming Task 4 as missing its Dependencies line, and naming task 20 as an unknown dependency of Task 3" | diff-local |
| Story 5 negative: Given a sliced plan where Task 4 has no Dependencies line, when land runs, then land refuses naming Task 4 as missing its Dependencies line | 7 | "`validatePlanSlices` returns an `invalid` result naming the task and listing the accepted Dependencies forms for the lines "Tasks 1–5" and "all prior.", naming Task 4 as missing its Dependencies line, and naming task 20 as an unknown dependency of Task 3" | diff-local |
| Story 5 negative: Given a sliced plan where Task 3's Dependencies line cites task 20 and no Task 20 exists, when land runs, then land refuses naming task 20 as an unknown dependency of Task 3 | 7 | "`validatePlanSlices` returns an `invalid` result naming the task and listing the accepted Dependencies forms for the lines "Tasks 1–5" and "all prior.", naming Task 4 as missing its Dependencies line, and naming task 20 as an unknown dependency of Task 3" | diff-local |
| Story 6 happy: Given a well-formed sliced plan declaring exactly five slices, when land runs, then no bound refusal is raised | 8 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-bound.test.ts` asserts the six-slice fixture throws gate `plan-slices` whose message contains the validator message stating that the plan declares 6 slices and the bound is 5, the six-with-an-empty-slice fixture's single refusal names the bound and the empty slice, and the five-slice fixture and the one-slice-holding-every-task fixture land with no slice refusal" | diff-local |
| Story 6 happy: Given a well-formed sliced plan declaring one slice that holds every task, when land runs, then no slice refusal is raised | 8 | "a land test in `src/conductor/test/engine/engineer/land-spec-plan-slices-bound.test.ts` asserts the six-slice fixture throws gate `plan-slices` whose message contains the validator message stating that the plan declares 6 slices and the bound is 5, the six-with-an-empty-slice fixture's single refusal names the bound and the empty slice, and the five-slice fixture and the one-slice-holding-every-task fixture land with no slice refusal" | diff-local |
| Story 6 negative: Given a sliced plan declaring six otherwise well-formed slices, when land runs, then land refuses stating the plan declares 6 slices and the bound is 5 | 8 | "`validatePlanSlices` returns an `invalid` result whose message states that the plan declares 6 slices and the bound is 5 for six well-formed slices, and returns one result naming both the bound and the empty slice when one of six slices is also empty" | diff-local |
| Story 6 negative: Given a sliced plan declaring six slices where one slice is also empty, when land runs, then one refusal names both the bound and the empty slice | 8 | "`validatePlanSlices` returns an `invalid` result whose message states that the plan declares 6 slices and the bound is 5 for six well-formed slices, and returns one result naming both the bound and the empty slice when one of six slices is also empty" | diff-local |
| Story 7 happy: Given a sliced feature whose `coverage_binding` envelope recorded Task 4 in slice 1, when the plan is amended to move Task 4 into slice 2, resealed by the operator, and `coverage_binding` re-runs, then the step completes and a `plan_slices_changed` event names Task 4 as moved from slice 1 to slice 2 | 12, 10 | "when the prior envelope recorded Task 4 in slice 1 and the resealed plan holds Task 4 in slice 2, the runner completes, emits one `plan_slices_changed` event whose `moved` names Task 4 from slice 1 to slice 2, and the new envelope records Task 4 in slice 2" | diff-local |
| Story 7 happy: Given the same amendment, when `coverage_binding` re-runs, then the envelope records Task 4 in slice 2 | 12 | "when the prior envelope recorded Task 4 in slice 1 and the resealed plan holds Task 4 in slice 2, the runner completes, emits one `plan_slices_changed` event whose `moved` names Task 4 from slice 1 to slice 2, and the new envelope records Task 4 in slice 2" | diff-local |
| Story 7 happy: Given a feature whose prior envelope recorded no slice membership, when `coverage_binding` runs on a sliced plan, then it records the membership and emits no `plan_slices_changed` event | 12 | "when the prior envelope has no `sliceMembership`, including an unsliced feature amended to add a `## Slices` section, the runner records the membership and emits no `plan_slices_changed` event, and when the recorded membership equals the plan's it emits no event" | diff-local |
| Story 7 happy: Given a sliced feature whose recorded membership already matches the plan, when `coverage_binding` re-runs, then no `plan_slices_changed` event is emitted | 12 | "when the prior envelope has no `sliceMembership`, including an unsliced feature amended to add a `## Slices` section, the runner records the membership and emits no `plan_slices_changed` event, and when the recorded membership equals the plan's it emits no event" | diff-local |
| Story 7 happy: Given a sliced feature with the coverage-binding judge disabled, when `coverage_binding` runs, then the slice validation still runs before the judge-disabled exit | 11 | "the `coverage_binding` runner in `src/conductor/src/engine/step-runners.ts` calls `validatePlanSlices` on the resolved plan before its judge-disabled exit, as asserted in `src/conductor/test/engine/coverage-binding-slice-layer.test.ts` by a judge-disabled run whose sliced plan has a slice violation and is still refused" | diff-local |
| Story 7 negative: Given a sliced feature whose plan is amended to add Task 9 in no slice and resealed, when `coverage_binding` re-runs, then the step is refused as needs-human naming Task 9, appends no plan task, and does not route to `plan` | 11 | "for a sliced plan amended to add Task 9 in no slice, the runner returns a refusal of kind `needs-human` whose reason names Task 9, writes the envelope status `refused`, appends no plan task, and records no routing to `plan`, as asserted by the invalid-amendment test" | diff-local |
| Story 7 negative: Given a sliced feature whose recorded membership exists, when the plan is amended to remove its `## Slices` section and resealed, then `coverage_binding` completes and emits a `plan_slices_changed` event reporting the manifest dropped | 12 | "when the prior envelope recorded membership and the resealed plan has no `## Slices` section, the runner completes and emits `plan_slices_changed` with `manifest` set to `dropped`, and when the plan only gained `rem-build-review-2` it emits no `plan_slices_changed` event" | diff-local |
| Story 7 negative: Given a sliced feature whose recorded membership exists, when the engine appends remediation task `rem-build-review-2` and `coverage_binding` re-runs, then no `plan_slices_changed` event is emitted and no slice refusal is raised | 12, 11 | "when the prior envelope recorded membership and the resealed plan has no `## Slices` section, the runner completes and emits `plan_slices_changed` with `manifest` set to `dropped`, and when the plan only gained `rem-build-review-2` it emits no `plan_slices_changed` event" | diff-local |
| Story 7 negative: Given a sliced feature whose envelope was invalidated by an operator reseal, when the invalidated envelope is read, then its recorded slice membership is still present and the envelope still does not count as completion evidence | 9 | "`voidCoverageBindingForDecideChange` writes the invalidated envelope with the prior `sliceMembership` field unchanged, and `COVERAGE_BINDING_COMPLETION_STATUSES` still equals `['disabled', 'done']` so the invalidated envelope is not completion evidence, as asserted in `src/conductor/test/engine/coverage-binding-void.test.ts`" | diff-local |
| Story 7 negative: Given an unsliced feature whose plan is amended to add a `## Slices` section and resealed, when `coverage_binding` re-runs with a prior envelope that recorded no membership, then it records the membership and emits no `plan_slices_changed` event | 12 | "when the prior envelope has no `sliceMembership`, including an unsliced feature amended to add a `## Slices` section, the runner records the membership and emits no `plan_slices_changed` event, and when the recorded membership equals the plan's it emits no event" | diff-local |
| Story 8 happy: Given the slice example in `skills/plan/SKILL.md`, when it is passed to the slice validator together with the task headings it cites, then the validator returns a sliced result with no violation | 13 | "a test in `src/conductor/test/engine/plan-slices-skill-contract.test.ts` extracts that fenced example and asserts `validatePlanSlices` returns `kind: 'sliced'` with no violation" | diff-local |
| Story 8 negative: Given the slice example in `skills/plan/SKILL.md` edited to cite a task the example does not declare, when the drift test runs, then the test fails naming the unknown task id | 13 | "`assertSkillSliceExample`, the helper the drift test calls, throws an error containing the unknown task id when given the example edited to cite an undeclared task, and an error containing the refused Dependencies line when given the example edited to "Tasks 1–3", as asserted by two mutation tests" | diff-local |
| Story 8 negative: Given the slice example in `skills/plan/SKILL.md` edited to use a Dependencies range, when the drift test runs, then the test fails naming the refused Dependencies line | 13 | "`assertSkillSliceExample`, the helper the drift test calls, throws an error containing the unknown task id when given the example edited to cite an undeclared task, and an error containing the refused Dependencies line when given the example edited to "Tasks 1–3", as asserted by two mutation tests" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-29-plan-slice-manifest#D1 | task | task-3, task-5 | a message stating that the Slices section must precede the first task |
| adr-2026-09-29-plan-slice-manifest#D2 | task | task-3, task-4, task-11 | `landSpec` calls `validatePlanSlices` on the plan text after the task-count check |
| adr-2026-09-29-plan-slice-manifest#D3 | task | task-6, task-8 | raises no membership violation for a task heading whose id satisfies `isEngineAppendedRemediationTaskId` |
| adr-2026-09-29-plan-slice-manifest#D4 | task | task-7 | never parses the Dependencies lines of a plan that has no `## Slices` section |
| adr-2026-09-29-plan-slice-manifest#D5 | task | task-4, task-5, task-6 | both runs refuse with gate `plan-slices` and identical refusal message strings |
| adr-2026-09-29-plan-slice-manifest#D6 | task | task-9, task-11, task-12 | calls `validatePlanSlices` on the resolved plan before its judge-disabled exit |
| adr-2026-09-29-plan-slice-manifest#D7 | task | task-10 | declares `plan_slices_changed` as `{ render: false, persist: true, audit: false, otel: false }` |
| adr-2026-09-29-plan-slice-manifest#D8 | task | task-1, task-2 | declares `stacked_prs` and `stacked_prs.enabled` each as a `none` consumer whose reason contains `#2724` |
| adr-2026-09-29-plan-slice-manifest#D9 | task | task-13 | extracts that fenced example and asserts `validatePlanSlices` returns `kind: 'sliced'` with no violation |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic

### Task rem-as-built-rem-adr-001: src/conductor/src/engine/plan-slices.ts:112 (Task 5) — require the row after the Slices header to be a markdown delimiter row (exactly three cells, each matching /^:?-{3,}:?$/) and push a 'missing-table'/'malformed-delimiter' violation otherwise; at plan-slices.ts:125-129 stop the data-row loop only on a non-table line (blank or non-pipe), and push a 'malformed-row' invalid violation naming the row's line text when a pipe row has a cell count other than 3, so a complete valid row followed by a four-cell row returns kind 'invalid'. Keep every existing Task 3/5/6/7/8 assertion unchanged.
**Gate:** as-built
**Rationale:** plan-slices.ts:112 accepts any pipe-shaped line as the header delimiter and plan-slices.ts:125-129 breaks silently on a non-three-cell data row, so a malformed row after a complete manifest still yields kind 'sliced', contrary to adr-2026-09-29-plan-slice-manifest D3; the approved architecture stands and the fix is determinable, and it is admitted by Task 5 (Refuse malformed manifest grammar), which owns grammar violations in plan-slices.ts, plan-slices-grammar.test.ts and land-spec-plan-slices-grammar.test.ts. Existing Task 5 grammar violations and Tasks 3/6-8 valid-plan assertions (three-slice, position-gap, annotation) must keep passing, so no delivered coverage is removed. Sibling sweep: the table-row loop is the only site that ends the table; the tableCells helper is shared by header parsing, which already refuses wrong column counts.
**Governing clause:** adr-2026-09-29-plan-slice-manifest decision 3
**Done when:**
- adr-2026-09-29-plan-slice-manifest decision 3 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-001 is complete.

### Task rem-as-built-rem-adr-002: src/conductor/test/engine/plan-slices-grammar.test.ts and src/conductor/test/engine/engineer/land-spec-plan-slices-grammar.test.ts (Task 5) — add validator tests that (a) a manifest whose second table line is '| a | b | c |' instead of a delimiter returns invalid naming the delimiter, and (b) a manifest whose rows assign every task followed by the row '| 3 | Extra | 4 | x |' returns invalid naming the malformed row; add the matching land tests asserting LandGateError gate 'plan-slices' carrying the validator message and no spec commit.
**Gate:** as-built
**Rationale:** plan-slices.ts:112 accepts any pipe-shaped line as the header delimiter and plan-slices.ts:125-129 breaks silently on a non-three-cell data row, so a malformed row after a complete manifest still yields kind 'sliced', contrary to adr-2026-09-29-plan-slice-manifest D3; the approved architecture stands and the fix is determinable, and it is admitted by Task 5 (Refuse malformed manifest grammar), which owns grammar violations in plan-slices.ts, plan-slices-grammar.test.ts and land-spec-plan-slices-grammar.test.ts. Existing Task 5 grammar violations and Tasks 3/6-8 valid-plan assertions (three-slice, position-gap, annotation) must keep passing, so no delivered coverage is removed. Sibling sweep: the table-row loop is the only site that ends the table; the tableCells helper is shared by header parsing, which already refuses wrong column counts.
**Governing clause:** adr-2026-09-29-plan-slice-manifest decision 3
**Done when:**
- adr-2026-09-29-plan-slice-manifest decision 3 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-002 is complete.

### Task rem-as-built-rem-adr-003: docs/reference/configuration.md (Tasks 1-2, D8) — add a `stacked_prs` row to the Key index table (type object, default disabled, link #stacked_prs) and a `## stacked_prs` section after `## mergeable_autoresolve` with a key table for `stacked_prs.enabled` (boolean, boolean else hard error, default false), stating unknown sub-keys and non-object values are hard errors, that the key is reserved with no runtime consumer yet (#2724), and that the plan-slices land gate and coverage_binding slice layer run regardless of the flag; match the commented entry in templates/project-config.yml.template.
**Gate:** as-built
**Rationale:** adr-2026-09-29-plan-slice-manifest D8 requires stacked_prs in the configuration reference, but docs/reference/configuration.md has no Key index row (index table ends ~line 207 with mergeable_autoresolve) and no section, while templates/project-config.yml.template:364 already carries the commented entry; this is documentation drift that preserves the approved architecture, completing the D8 obligation that Tasks 1-2 (stacked_prs config block and reserved consumer/template entry) implement, so it routes build rather than plan. Matched pair: the Key index row and the new section must agree with CONFIG_CONSUMER_KEY_SETS.stacked_prs ['enabled'] in config.ts and the template entry; no other docs file lists top-level keys exhaustively.
**Governing clause:** adr-2026-09-29-plan-slice-manifest decision 8
**Done when:**
- adr-2026-09-29-plan-slice-manifest decision 8 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-adr-003 is complete.
