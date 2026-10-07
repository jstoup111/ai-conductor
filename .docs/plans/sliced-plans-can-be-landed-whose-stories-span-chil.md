# Implementation Plan: Sliced plans — story ownership and stack eligibility (#2941)

**Date:** 2026-10-07
**Design:** `.docs/decisions/adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility.md` (technical track, no PRD)
**Stories:** `.docs/stories/sliced-plans-can-be-landed-whose-stories-span-chil.md`
**Conflict check:** Clean as of 2026-10-07

## Summary

Adds story→child ownership and a single stack-eligibility verdict for sliced plans. Both are
enforced by a new land rung and re-checked at `coverage_binding` under the current config. Also adds
the `stacked_prs.max_slices` key, raises the grammar ceiling to `MAX_CHILD_ID`, records ownership in
the coverage-binding envelope, and teaches `/plan` to propose slices. 17 tasks.

## Technical Approach

- **Pure predicates, one owner.** `plan-slices.ts` gains three pure, model-free functions:
  - `deriveStoryOwnership(planText, slices)`: story → slice position, or typed violations
    `story-spans-children` and `multi-story-line`;
  - `customStepsInPerChildRegion(registry)`: custom steps whose resolved index lies strictly between
    `acceptance_specs` and `build_review` in a `buildStepRegistry` result. A custom step is a
    registry entry whose name is not in `ALL_STEPS`;
  - `evaluateStackEligibility(input)`: tier, sign-off, slice count against `max_slices`, and in-region
    customs, returning every reason.

  Land and the `coverage_binding` runner stay the only production importers of `plan-slices.ts`.
- **Parsing.**
  - `plan-task-parse.ts` gains `parsePlanTaskStoryLineIds`, which returns every id on a `**Story:**`
    line, splitting on `,` and the word `and`. `parsePlanTaskStoryIds` is untouched.
  - `artifacts.ts` gains `parseStackedDeliverySignoff`, modeled on `parseComplexityTier` /
    `parseTrack`: one case-insensitive `^\s*Stacked-Delivery:\s*(\S+)` line. It returns `approved`
    only for the value `approved`.
- **Engagement.** The new land rung `stacked-delivery` and the runner layer engage only when
  `validatePlanSlices` returns `sliced` **and** the resolved config has `stacked_prs.enabled === true`.
  - Land reads tier and sign-off from the worktree `.docs/complexity/<stem>.md`. It reads config
    through the existing `loadConfig(canonical)` and builds the registry with `buildStepRegistry`.
  - The runner reads the complexity file by the selected plan's stem and uses its own
    `this.config` / `this.stepRegistry`, so post-merge config drift is seen.
- **Bounds.** The `plan-slices` grammar bound becomes `MAX_CHILD_ID` from `child-context.ts`, and
  `MAX_PLAN_SLICES` is removed. `stacked_prs.max_slices` is validated in `validateStackedPrsBlock`
  (default 1, accepted 1–9, a warning above 5, `validation_error` otherwise). It is read only by
  `evaluateStackEligibility`'s callers.
- **Envelope.** `coverage-binding-envelope.ts` gains an optional `storyOwnership` record, parsed and
  kept exactly like `sliceMembership`, never in the judge payload and never affecting completion. A
  pure `projectChildOwnership(envelope, position)` gives #2942 a read-only child view.
- **Local pattern basis.**
  - **Precedent:** the existing `plan-slices` land rung and the runner's `sliceMembership` handling.
    Find them via `validatePlanSlices`, `landGateError('plan-slices'`, `sliceMembership` and
    `parseSliceMembership`.
  - **Traits to preserve:** pure offline predicates; every violation reported; refusal via the
    existing `landGateError` / `{ refusal: { kind: 'needs-human' } }` paths; an optional envelope
    field validated with `exactKeys`.
  - **Allowed variation:** the new rung is flag-gated.
- **Sequencing.** Parsers, config and the envelope schema come first, then the predicates, then land
  and runner wiring, the registry rows, and the skill.

## Prerequisites

- None. Child identity (`child-context.ts`, `MAX_CHILD_ID`) shipped via #3019.

## Tasks

### Task 1: Story-line reader returns every cited id
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-task-parse.test.ts`: `parsePlanTaskStoryLineIds` returns one entry per `**Story:**` line with all ids.
2. Verify RED.
3. Implement `parsePlanTaskStoryLineIds(text)` in `plan-task-parse.ts`. Reuse the `STORY_LINE` prefix grammar (optional `story`/`epic` word), split the remainder on `,` and the word `and`, drop the non-story tokens `n/a`, `none`, `prerequisite`, `all`, and strip annotations after the id. Leave `parsePlanTaskStoryIds` untouched.
4. Verify GREEN, then commit.

**Done when:**
- [test] `parsePlanTaskStoryLineIds` returns ids `["1","2"]` for `**Story:** 1, 2`, `["FR-1","FR-2"]` for `**Story:** FR-1 and FR-2`, and `["1"]` for `**Story:** Story 1`.
- [test] `parsePlanTaskStoryIds` still returns `["FR-1"]` for a task carrying `**Story:** FR-1, FR-2, FR-3`, and its existing tests pass unchanged.
- [test] `parsePlanTaskStoryLineIds` returns no ids for Story lines whose value is `n/a`, `none`, `prerequisite` or `all`.

**Files likely touched:**
- `src/conductor/src/engine/plan-task-parse.ts` — new reader
- `src/conductor/test/engine/plan-task-parse.test.ts` — reader tests

**Dependencies:** none

### Task 2: Story-ownership predicate
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-slices-ownership.test.ts`. Build plan fixtures with a `## Slices` table and per-task `**Story:**` lines.
2. Verify RED.
3. Implement `deriveStoryOwnership(planText, slices)` in `plan-slices.ts`. Split task blocks with `TASK_HEADER_PATTERN`, read Story lines with `parsePlanTaskStoryLineIds`, and skip `isEngineAppendedRemediationTaskId` tasks. Report every violation, not the first, following the existing `validatePlanSlices` violation shape (`code`, `position`, `taskId`, `message`). Keep it pure and offline.
4. Verify GREEN, then commit.

**Done when:**
- [test] `deriveStoryOwnership` returns ownership `{ "1": 1, "2": 2 }` for a two-slice plan whose story 1 tasks sit in slice 1 and story 2 tasks in slice 2.
- [test] a task with no Story line and a task with `**Story:** n/a` in slice 2 produce no violation and own no story.
- [test] story 2 cited by T3 in slice 1 and T5 in slice 2 yields one `story-spans-children` violation whose message names story `2` and positions `1` and `2`, and two spanning stories yield two such violations, each naming its own story and positions.
- [test] an engine-appended remediation task citing story 1 from slice 2 is ignored and yields no `story-spans-children` violation.
- [test] `**Story:** 1, 2` on T2 and `**Story:** FR-1 and FR-2` on T4 each yield a `multi-story-line` violation naming the task id and the line text, and no story is dropped from the reported ids.

**Files likely touched:**
- `src/conductor/src/engine/plan-slices.ts` — `deriveStoryOwnership`
- `src/conductor/test/engine/plan-slices-ownership.test.ts` — predicate tests

**Dependencies:** Task 1

### Task 3: Stacked-delivery sign-off parser
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stacked-delivery-signoff.test.ts`.
2. Verify RED.
3. Implement `parseStackedDeliverySignoff(content)` in `artifacts.ts` beside `parseComplexityTier`, using the same single-line, case-insensitive shape. Return `'approved'` only for the value `approved` (any case), and `'absent'` otherwise, including null content.
4. Verify GREEN, then commit.

**Done when:**
- [test] `parseStackedDeliverySignoff` returns `approved` for `Stacked-Delivery: approved` and for `stacked-delivery: APPROVED`.
- [test] `parseStackedDeliverySignoff` returns `absent` for content with no `Stacked-Delivery:` line and for `Stacked-Delivery: pending`.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — sign-off parser
- `src/conductor/test/engine/stacked-delivery-signoff.test.ts` — parser tests

**Dependencies:** none

### Task 4: `stacked_prs.max_slices` config key
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/stacked-prs-config.test.ts`.
2. Verify RED.
3. Implement:
   - add `max_slices?: number` to `StackedPrsConfig`;
   - set `CONFIG_CONSUMER_KEY_SETS.stacked_prs` to `['enabled', 'max_slices']`;
   - in `validateStackedPrsBlock`, refuse a non-integer, `< 1` or `>= 10` value as a `validation_error` naming `stacked_prs.max_slices`;
   - in config resolution, default `max_slices` to 1 and push a warning naming `stacked_prs.max_slices` for values above 5 (follow the existing `warnings.push` usage in `config.ts`).
4. Verify GREEN, then commit.

**Done when:**
- [test] `loadProjectConfig` resolves `stacked_prs.max_slices` to 1 when the key is absent and accepts integers 1 through 9, emitting a warning naming `stacked_prs.max_slices` for 7 and for 6, and no warning for 5.
- [test] `max_slices` values 10, 0, 2.5 and the string "3" each produce a `validation_error` naming `stacked_prs.max_slices`.
- [test] an unknown sub-key `max_parallel` under `stacked_prs` still produces the `Unknown key in stacked_prs` validation_error, and `CONFIG_CONSUMER_KEY_SETS.stacked_prs` equals `['enabled', 'max_slices']`.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — validation, default, warning
- `src/conductor/src/types/config.ts` — `StackedPrsConfig.max_slices`
- `src/conductor/test/engine/stacked-prs-config.test.ts` — config tests

**Dependencies:** none

### Task 5: Consumer registry names the real readers of `stacked_prs`
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Change `src/conductor/test/engine/config-consumer-registry.ts` so its rows for `stacked_prs`, `stacked_prs.enabled` and `stacked_prs.max_slices` name `src/conductor/src/engine/engineer/land-spec.ts` and `src/conductor/src/engine/step-runners.ts` as consumers. This replaces the `none` reservation for #2724. Use the same consumer form as other multi-reader rows.
2. Run the registry totality test (`config-consumer-registry.test.ts`) and confirm it passes.
3. Commit.

**Done when:**
- [test] the config consumer registry declares `stacked_prs`, `stacked_prs.enabled` and `stacked_prs.max_slices` with `land-spec.ts` and `step-runners.ts` as consumers, no `none` row reserved for #2724 remains, and the registry totality test passes.
- `src/conductor/test/engine/config-consumer-registry.ts` contains no row for any `stacked_prs` key whose reason cites #2724.

**Files likely touched:**
- `src/conductor/test/engine/config-consumer-registry.ts` — registry rows

**Dependencies:** Task 4, Task 9, Task 12

### Task 6: Grammar ceiling becomes `MAX_CHILD_ID`
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Update the failing tests in `src/conductor/test/engine/plan-slices-bound.test.ts`, `src/conductor/test/engine/child-context.test.ts` and `src/conductor/test/engine/engineer/land-spec-plan-slices-bound.test.ts` to the 9/10 bound, and add the drift test.
2. Verify RED.
3. In `plan-slices.ts`, remove `MAX_PLAN_SLICES`, import `MAX_CHILD_ID` from `child-context.ts` as the bound, and keep the message shape `plan declares N slices and the bound is 9`. `validatePlanSlices` reads no config.
4. Verify GREEN, then commit.

**Done when:**
- [test] `validatePlanSlices` returns `sliced` for a nine-slice plan, and returns `invalid` for a ten-slice plan with a message containing `10` and `9`.
- [test] a ten-slice plan with one empty slice yields one `invalid` result naming both the bound and the empty slice, and `landSpec` with the flag off commits a nine-slice plan.
- [test] a drift test asserts the `plan-slices` grammar bound and the largest accepted `stacked_prs.max_slices` value are both no greater than `MAX_CHILD_ID`.
- `MAX_PLAN_SLICES` no longer exists in `src/conductor/src/engine/plan-slices.ts`, and `validatePlanSlices` takes only plan text.

**Files likely touched:**
- `src/conductor/src/engine/plan-slices.ts` — bound
- `src/conductor/test/engine/plan-slices-bound.test.ts` — bound tests
- `src/conductor/test/engine/child-context.test.ts` — drift test
- `src/conductor/test/engine/engineer/land-spec-plan-slices-bound.test.ts` — land bound tests

**Dependencies:** Task 4

### Task 7: Per-child-region custom-step classifier
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-slices-region.test.ts`, building registries with `buildStepRegistry` from config fixtures.
2. Verify RED.
3. Implement `customStepsInPerChildRegion(registry)` in `plan-slices.ts`. It returns, in registry order, the names of entries not in `ALL_STEPS` whose index lies strictly between the indices of `acceptance_specs` and `build_review`. It classifies by resolved registry order, never by `after` text.
4. Verify GREEN, then commit.

**Done when:**
- [test] for registries built by `buildStepRegistry` with customs `after: explore`, `after: coverage_binding` or `after: build_review`, `customStepsInPerChildRegion` returns an empty list.
- [test] a custom `lint_gate` with `after: test_suite` yields `['lint_gate']`, and customs `a` (`after: build`) and `b` (`after: a`) yield `['a', 'b']`.
- [test] a custom `spec_lint` with `after: acceptance_specs` yields `['spec_lint']`, and `customStepsInPerChildRegion`, `deriveStoryOwnership` and `evaluateStackEligibility` are exported from `plan-slices.ts` and perform no filesystem access.
- [test] a custom whose `after` target does not resolve is absent from the returned list, and `loadProjectConfig` for that config still returns the existing validation error naming the unresolved `after` target.

**Files likely touched:**
- `src/conductor/src/engine/plan-slices.ts` — classifier
- `src/conductor/test/engine/plan-slices-region.test.ts` — classifier tests

**Dependencies:** none

### Task 8: Stack-eligibility verdict
**Story:** Story 4, Story 5, Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-slices-eligibility.test.ts`.
2. Verify RED.
3. Implement `evaluateStackEligibility({ tier, signoff, slicePositions, maxSlices, inRegionCustomSteps, complexityPath })` in `plan-slices.ts`. It returns `{ kind: 'eligible' }` or `{ kind: 'ineligible', reasons }` listing every reason. A position above `MAX_CHILD_ID` is a reason.
4. Verify GREEN, then commit.

**Done when:**
- [test] `evaluateStackEligibility` returns `eligible` for tier `M` and for tier `L` with sign-off `approved`, 2 slices with `maxSlices` 2, and no in-region custom.
- [test] tier `S` yields a reason naming tier `S` and stating stacked delivery requires tier M or L, an absent sign-off yields a reason stating no operator stacking sign-off is recorded in the given complexity path, and tier `S` with absent sign-off yields both reasons.
- [test] 2 slices with `maxSlices` 1 yield a reason naming 2 slices and `stacked_prs.max_slices` = 1, and an in-region custom `lint_gate` yields a reason naming `lint_gate` as inside the per-child region.
- [test] a slice at position 12 yields a reason naming position `12` above the `MAX_CHILD_ID` ceiling of 9, and a missing tier yields the same tier-M-or-L reason as tier `S`.

**Files likely touched:**
- `src/conductor/src/engine/plan-slices.ts` — verdict
- `src/conductor/test/engine/plan-slices-eligibility.test.ts` — verdict tests

**Dependencies:** Task 7

### Task 9: Land rung `stacked-delivery`: wiring and engagement
**Story:** Story 3, Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts`, using the fixture helpers of `land-spec-plan-slices.test.ts`.
2. Verify RED.
3. Implement in `land-spec.ts`:
   - add `'stacked-delivery'` to `LandGateIdentifier`;
   - after the `plan-slices` rung, when the result is `sliced` and `loadConfig(canonical)` resolves `stacked_prs.enabled === true`, read the worktree complexity file;
   - call `deriveStoryOwnership` and `evaluateStackEligibility`, with `customStepsInPerChildRegion(buildStepRegistry(config))`;
   - throw `landGateError('stacked-delivery', …)` joining every reason.

   Otherwise skip the rung entirely. A project config that fails to load is treated as flag off here, because land does not require a loadable config today. The build-time re-check (Task 12) still applies the real config.
4. Verify GREEN, then commit.

**Done when:**
- [test] `landSpec` on an eligible baseline (tier L, `Stacked-Delivery: approved`, 2 slices, `max_slices: 2`, single-owner stories) commits the spec and raises no `stacked-delivery` error, with single-id Story lines written both bare (`**Story:** 1`) and prefixed (`**Story:** Story 1`).
- [test] `landSpec` commits an eligible baseline whose slice 2 also holds a task with no Story line and a task with `**Story:** n/a`.
- [test] `landSpec` commits an unsliced plan with `stacked_prs.enabled: true` with the same commit message and committed paths as for that plan with the flag off, which are the pre-change values already asserted by the unmodified existing `land-spec.test.ts` unsliced-plan tests, and commits a flag-off sliced plan whose story spans two slices, whose tier is `S` and which has no sign-off, with the `stacked-delivery` rung not evaluated in either case.
- [test] `landSpec` also commits that spanning, tier-`S`, unsigned sliced plan when the project config has no `stacked_prs` block at all.
- [test] with the flag off, a sliced plan with a task in no slice fails with identifier `plan-slices` and not `stacked-delivery`, and a three-slice plan with no `max_slices` commits.

**Files likely touched:**
- `src/conductor/src/engine/engineer/land-spec.ts` — rung
- `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` — land tests

**Dependencies:** Task 2, Task 3, Task 6, Task 8

### Task 10: Land refuses ownership violations
**Story:** Story 1, Story 2
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts`.
2. Verify RED, then make GREEN through the Task 9 rung (adjust message joining if needed).
3. Commit.

**Done when:**
- [test] `landSpec` on an eligible baseline whose story 2 is cited in slices 1 and 2 throws `landGateError` identifier `stacked-delivery` with a message naming story `2` and positions `1` and `2`, and the worktree has no new commit.
- [test] `landSpec` with stories 2 and 3 each spanning slices 1 and 3 throws one `stacked-delivery` error naming both stories with their positions.
- [test] `landSpec` with `**Story:** 1, 2` on T2 throws `stacked-delivery` naming task `T2` and the line text, and with `**Story:** FR-1 and FR-2` on T4 throws `stacked-delivery` naming task `T4`.
- [test] `landSpec` on an unsliced plan whose task carries `**Story:** FR-1, FR-2, FR-3` commits with no multi-story-line refusal.
- [test] the `stacked-delivery` land message is the join of exactly the reason list `deriveStoryOwnership` and `evaluateStackEligibility` return for the same plan and config.

**Files likely touched:**
- `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` — refusal tests
- `src/conductor/src/engine/engineer/land-spec.ts` — message joining

**Dependencies:** Task 9

### Task 11: Land refuses ineligible stacked delivery
**Story:** Story 4, Story 5, Story 6
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` with project configs written into the fixture project's `.ai-conductor/config.yml`.
2. Verify RED, then make GREEN through the Task 9 rung.
3. Commit.

**Done when:**
- [test] `landSpec` on an eligible baseline with `Tier: M` commits, and with `Tier: S` throws `stacked-delivery` naming tier `S` and requiring tier M or L.
- [test] `landSpec` with no `Stacked-Delivery:` line, or with `Stacked-Delivery: pending`, throws `stacked-delivery` stating no operator stacking sign-off is recorded in `.docs/complexity/<stem>.md`, and tier `S` with no sign-off throws one error listing both reasons.
- [test] `landSpec` with custom `lint_gate` `after: test_suite` throws `stacked-delivery` naming `lint_gate` as inside the per-child region, customs `a` (`after: build`) and `b` (`after: a`) are both named, and customs after `explore`, `coverage_binding` or `build_review` commit.
- [test] `landSpec` with the flag on, `max_slices` absent and 2 slices throws `stacked-delivery` naming 2 slices and `stacked_prs.max_slices` = 1, and with `max_slices: 3` and 3 slices it commits.
- [test] `landSpec` on an otherwise eligible plan whose slices sit at positions 1 and 12 throws `stacked-delivery` naming position `12` and the ceiling 9.

**Files likely touched:**
- `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` — refusal tests

**Dependencies:** Task 9

### Task 12: `coverage_binding` re-checks ownership and eligibility under the current config
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts`, following `coverage-binding-runner.test.ts` fixtures.
2. Verify RED.
3. Implement in the `coverage_binding` runner (`step-runners.ts`), after the existing slice layer and before the ADR/judge layers. When the slice result is `sliced` and `this.config?.stacked_prs?.enabled === true`:
   - read `.docs/complexity/<plan stem>.md`;
   - call `deriveStoryOwnership` and `evaluateStackEligibility`, with `customStepsInPerChildRegion(this.stepRegistry)` and the current `max_slices`;
   - on any reason, call `writeEnvelope('refused', [])` and return `{ success: false, refusal: { kind: 'needs-human', reason } }`, where `reason` lists every predicate reason.

   It never appends a task or routes to `plan`. Otherwise the layer is inert.
4. Verify GREEN, then commit.

**Done when:**
- [test] the `coverage_binding` runner, for a merged eligible plan under unchanged config, passes the stacked-delivery layer and proceeds to its judge layer.
- [test] for an unsliced plan and for a sliced plan with `stacked_prs.enabled` false, the runner's result and written envelope equal those of today's runner, the flag being read only to leave the layer inert.
- [test] a sliced plan with story 2 spanning slices 1 and 2, run after the flag is turned on post-land, records envelope status `refused` and returns refusal kind `needs-human` naming story `2` and positions `1` and `2`, with no task appended and no route to `plan`.
- [test] adding custom `lint_gate` with `after: test_suite` after land, or lowering `max_slices` to 1 for a 2-slice plan, each yield a `needs-human` refusal naming `lint_gate`, or naming 2 slices and `stacked_prs.max_slices` = 1, read from the runner's current config and `buildStepRegistry`.
- [test] the refusal reason equals the reason list `deriveStoryOwnership` and `evaluateStackEligibility` return for the same plan and config.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — runner layer
- `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts` — runner tests

**Dependencies:** Task 2, Task 3, Task 8

### Task 13: Envelope carries optional `storyOwnership`
**Story:** Story 8
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`.
2. Verify RED.
3. In `coverage-binding-envelope.ts`, add an optional `storyOwnership: Readonly<Record<string, number>>`. Parse it with `exactKeys` and positive-integer positions as `parseSliceMembership` does, keep it on invalidation like `sliceMembership`, and leave `COVERAGE_BINDING_COMPLETION_STATUSES` unchanged.
4. Verify GREEN, then commit.

**Done when:**
- [test] the envelope parser round-trips an optional `storyOwnership` map of story id to slice position, rejects a non-integer or non-positive position, and keeps the field when the envelope is invalidated.
- [test] `COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged and an envelope's completion status is identical with and without `storyOwnership`.

**Files likely touched:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — field
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — envelope tests

**Dependencies:** none

### Task 14: Runner records ownership feature-scoped, outside the judge
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts`.
2. Verify RED.
3. In the runner, when the Task 12 layer passes, write the ownership map into the envelope beside `sliceMembership`. Never add it to the judge dispatch payload. Write no field for unsliced or flag-off plans.
4. Verify GREEN, then commit.

**Done when:**
- [test] the `coverage_binding` runner writes `storyOwnership` `{ "1": 1, "2": 2 }` beside `sliceMembership` for an eligible plan, and a re-run after an existing invalidation trigger on the unchanged plan reads back an equal map.
- [test] the judge dispatch payload assembled by the runner contains no `storyOwnership` data.
- [test] for an unsliced plan and for a flag-off sliced plan the written envelope has no `storyOwnership` field.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — record ownership
- `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts` — recording tests

**Dependencies:** Task 12, Task 13

### Task 15: Read-only child projection of the feature baseline
**Story:** Story 8
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/coverage-binding-envelope.test.ts`.
2. Verify RED.
3. Implement pure `projectChildOwnership(envelope, position)` in `coverage-binding-envelope.ts`. It returns that position's task ids and owned story ids, and never mutates or writes the envelope.
4. Verify GREEN, then commit.

**Done when:**
- [test] `projectChildOwnership` returns the stories and tasks owned by the given position, and the stored baseline (`sliceMembership` plus `storyOwnership`) serialized before and after the call is byte-identical.
- `projectChildOwnership` is a pure function in `coverage-binding-envelope.ts` with no filesystem access.

**Files likely touched:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — projection
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — projection test

**Dependencies:** Task 13

### Task 16: `/plan` proposes slices and records the sign-off
**Story:** Story 9
**Type:** happy-path

**Steps:**
1. Extend `src/conductor/test/engine/plan-slices-skill-contract.test.ts` to fail first.
2. Verify RED.
3. Edit `skills/plan/SKILL.md`, `## Slice manifest`:
   - propose a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on;
   - slice a Medium feature only when the operator asks for it;
   - on operator acceptance, write `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md`;
   - on decline, author no manifest and no sign-off line;
   - each story's tasks sit in one slice, and each `**Story:**` line cites one id;
   - the grammar bound is 9, with stacking bounded by `stacked_prs.max_slices`. This replaces "Use at most five slices".

   Keep the example manifest valid.
4. Verify GREEN, then commit.

**Done when:**
- `skills/plan/SKILL.md` instructs proposing a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on (slicing a Medium feature only when the operator asks), writing `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md` only on operator acceptance, and authoring no manifest and no sign-off line on decline.
- `skills/plan/SKILL.md` states the one-story-per-child rule, the single-id `**Story:**` line rule, and the grammar bound of 9 with stacking bounded by `stacked_prs.max_slices`.
- [test] `plan-slices-skill-contract.test.ts` parses the skill's example manifest and Story lines with `validatePlanSlices` and `deriveStoryOwnership` requiring `sliced` with no ownership violation, and parses the skill's example sign-off line with `parseStackedDeliverySignoff` requiring `approved`.

**Files likely touched:**
- `skills/plan/SKILL.md` — slice proposal and authoring rules
- `src/conductor/test/engine/plan-slices-skill-contract.test.ts` — drift test

**Dependencies:** Task 2, Task 3, Task 6

### Task 17: Stacked-delivery refusals are ordered, non-waivable and pre-judge
**Story:** Story 7, Story 1
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` and `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts`.
2. Verify RED, then make GREEN. The land rung must run after `plan-slices` and consult no waiver parser. The runner layer must return before any judge dispatch.
3. Commit.

**Done when:**
- [test] `landSpec` on a sliced, flag-on plan that has both a task in no slice and a story spanning two slices fails with identifier `plan-slices`, so the `stacked-delivery` rung runs only after `plan-slices` passes.
- [test] `landSpec` with a `.docs/coherence-waivers/<stem>.md` file naming the spanning story still throws `stacked-delivery`, so no waiver bypasses the rung.
- [test] a `coverage_binding` run refused by the stacked-delivery layer makes zero calls to the judge dispatcher mock.

**Files likely touched:**
- `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` — ordering and waiver tests
- `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts` — pre-judge test

**Dependencies:** Task 10, Task 12

## Task Dependency Graph

```
1 ──► 2 ──┬──────────────► 9 ──┬──► 10
3 ────────┤                    ├──► 11
4 ──► 6 ──┤                    └──► 5 (also needs 4, 12)
7 ──► 8 ──┴──► 12 ──► 14
13 ──────────────────► 14
13 ──► 15
10, 12 ──► 17
2, 3, 6 ──► 16
```

## Integration Points

- After Task 9: `ai-conductor compose land` (via `landSpec`) applies the `stacked-delivery` rung end to end.
- After Task 12: a daemon build's `coverage_binding` step re-checks stacked delivery under the current config.
- After Task 14: #2942 can read recorded story ownership through `projectChildOwnership` (Task 15).

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an eligible baseline whose story `1` is cited only by tasks in slice 1 and story `2` only by tasks in slice 2, when `ai-conductor compose land` runs, then the spec commits and land reports no `stacked-delivery` violation. | 9 | "commits the spec and raises no `stacked-delivery` error" | diff-local |
| Story 1 happy: Given an eligible baseline in which a task with no `**Story:**` line, and a task whose Story line is `n/a`, sit in slice 2 while story `1` is owned by slice 1, when land runs, then the spec commits: infrastructure tasks may sit in any child. | 9 | "also holds a task with no Story line and a task with `**Story:** n/a`" | diff-local |
| Story 1 negative: Given an eligible baseline except that story `2` is cited by task `T3` in slice 1 and task `T5` in slice 2, when land runs, then land fails with gate `stacked-delivery`, and the message names story `2` and child positions `1` and `2`. No commit is created. | 10 | "throws `landGateError` identifier `stacked-delivery` with a message naming story `2` and positions `1` and `2`, and the worktree has no new commit" | diff-local |
| Story 1 negative: Given a stacked candidate in which stories `2` and `3` each span slices 1 and 3, when land runs, then one refusal names both stories, each with its child positions, rather than only the first. | 10 | "throws one `stacked-delivery` error naming both stories with their positions" | diff-local |
| Story 1 negative: Given an eligible baseline in which an engine-appended remediation task cites story `1` from slice 2, when ownership is evaluated, then that task is ignored and no `story-spans-children` violation is reported. | 2 | "an engine-appended remediation task citing story 1 from slice 2 is ignored and yields no `story-spans-children` violation" | diff-local |
| Story 2 happy: Given an eligible baseline whose every `**Story:**` line carries exactly one id (with or without a `Story ` prefix), when land runs, then the spec commits. | 9 | "commits the spec and raises no `stacked-delivery` error" | diff-local |
| Story 2 negative: Given an eligible baseline except that task `T2` carries `**Story:** 1, 2`, when land runs, then land fails with gate `stacked-delivery`, and the message names task `T2` and the line text. Story `2` is not silently dropped. | 10 | "with `**Story:** 1, 2` on T2 throws `stacked-delivery` naming task `T2` and the line text" | diff-local |
| Story 2 negative: Given an eligible baseline except that task `T4` carries `**Story:** FR-1 and FR-2`, when land runs, then the same `multi-story-line` refusal names task `T4`. | 10 | "with `**Story:** FR-1 and FR-2` on T4 throws `stacked-delivery` naming task `T4`" | diff-local |
| Story 2 negative: Given an **unsliced** plan whose task carries `**Story:** FR-1, FR-2, FR-3`, when land runs, then no multi-story-line refusal is raised and `parsePlanTaskStoryIds` still returns `["FR-1"]` for that task, as it does today. | 1, 10 | "`parsePlanTaskStoryIds` still returns `["FR-1"]` for a task carrying `**Story:** FR-1, FR-2, FR-3`" | diff-local |
| Story 3 happy: Given an unsliced plan in a project with `stacked_prs.enabled: true`, when land runs, then no `stacked-delivery` check runs, and land's outcome equals the outcome before this change. | 9 | "`landSpec` commits an unsliced plan with `stacked_prs.enabled: true`" | diff-local |
| Story 3 happy: Given a sliced plan with the flag off (or no `stacked_prs` block) whose story spans two slices, whose tier is `S`, and that has no sign-off, when land runs, then it commits. Only the existing `plan-slices` grammar rung applies. | 9 | "commits a flag-off sliced plan whose story spans two slices, whose tier is `S` and which has no sign-off" | diff-local |
| Story 3 negative: Given a sliced plan with the flag off that is malformed under the existing grammar (a task in no slice), when land runs, then it still fails with the existing gate `plan-slices` and not with `stacked-delivery`. | 9 | "a sliced plan with a task in no slice fails with identifier `plan-slices` and not `stacked-delivery`" | diff-local |
| Story 3 negative: Given the flag off and `stacked_prs.max_slices` absent, when a sliced plan with 3 slices lands, then it commits. The default `max_slices` of 1 does not refuse it, because `max_slices` applies only through stack eligibility. | 9 | "a three-slice plan with no `max_slices` commits" | diff-local |
| Story 4 happy: Given an eligible baseline with `Tier: M` and `Stacked-Delivery: approved`, when land runs, then it commits. | 11 | "`landSpec` on an eligible baseline with `Tier: M` commits" | diff-local |
| Story 4 happy: Given a complexity artifact containing `stacked-delivery: APPROVED` in a different letter case, when the sign-off is parsed, then it is recognized as approved. | 3 | "`parseStackedDeliverySignoff` returns `approved` for `Stacked-Delivery: approved` and for `stacked-delivery: APPROVED`" | diff-local |
| Story 4 negative: Given an eligible baseline except `Tier: S`, when land runs, then land fails with gate `stacked-delivery`, and the message says stacked delivery requires tier M or L and names tier `S`. | 11 | "with `Tier: S` throws `stacked-delivery` naming tier `S` and requiring tier M or L" | diff-local |
| Story 4 negative: Given an eligible baseline whose complexity artifact has no `Stacked-Delivery:` line, when land runs, then land fails, and the message says no operator stacking sign-off is recorded in `.docs/complexity/<stem>.md`. | 11 | "with no `Stacked-Delivery:` line, or with `Stacked-Delivery: pending`, throws `stacked-delivery` stating no operator stacking sign-off is recorded in `.docs/complexity/<stem>.md`" | diff-local |
| Story 4 negative: Given `Stacked-Delivery: pending` (any value other than `approved`), when land runs, then it is treated as no sign-off and refused with the same message. | 11 | "or with `Stacked-Delivery: pending`, throws `stacked-delivery` stating no operator stacking sign-off is recorded" | diff-local |
| Story 4 negative: Given a stacked candidate that is both tier `S` and unsigned, when land runs, then one refusal lists both reasons. | 11 | "tier `S` with no sign-off throws one error listing both reasons" | diff-local |
| Story 5 happy: Given an eligible baseline whose config has a custom step `after: explore` (DECIDE), when land runs, then it commits. | 11 | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| Story 5 happy: Given an eligible baseline whose config has a custom step `after: build_review`, when land runs, then it commits. | 11 | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| Story 5 happy: Given an eligible baseline whose config has a custom step `after: coverage_binding` (before `acceptance_specs`), when land runs, then it commits. | 11 | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| Story 5 negative: Given an eligible baseline whose config has custom step `lint_gate` with `after: test_suite`, when land runs, then land fails with gate `stacked-delivery`, and the message names `lint_gate` as inside the per-child region. | 11, 8 | "`landSpec` with custom `lint_gate` `after: test_suite` throws `stacked-delivery` naming `lint_gate`" | diff-local |
| Story 5 negative: Given custom step `a` with `after: build` and custom step `b` with `after: a`, when land runs, then the refusal names both `a` and `b`. | 11 | "customs `a` (`after: build`) and `b` (`after: a`) are both named" | diff-local |
| Story 5 negative: Given a custom step whose `after` target does not resolve, when eligibility is evaluated, then that step is not reported as in-region, and the existing config validator still reports the broken `after`. | 7 | "a custom whose `after` target does not resolve is absent from the returned list" | diff-local |
| Story 6 happy: Given `stacked_prs: { enabled: true, max_slices: 3 }` and an otherwise eligible plan with 3 slices, when land runs, then it commits. | 11 | "with `max_slices: 3` and 3 slices it commits" | diff-local |
| Story 6 happy: Given `max_slices: 7`, when config loads, then it is accepted and a warning naming `stacked_prs.max_slices` is logged for a value above 5. | 4 | "accepts integers 1 through 9, emitting a warning naming `stacked_prs.max_slices` for 7" | diff-local |
| Story 6 happy: Given the flag off and a sliced plan with 7 slices, when land runs, then the `plan-slices` grammar rung accepts it (the ceiling is 9, no longer 5). | 6 | "`landSpec` with the flag off commits a nine-slice plan" | diff-local |
| Story 6 negative: Given the flag on, `max_slices` absent (default 1), and an otherwise eligible plan with 2 slices, when land runs, then land fails with gate `stacked-delivery`, and the message names 2 slices against `stacked_prs.max_slices` = 1. | 11 | "`landSpec` with the flag on, `max_slices` absent and 2 slices throws `stacked-delivery` naming 2 slices and `stacked_prs.max_slices` = 1" | diff-local |
| Story 6 negative: Given `max_slices: 10`, `0`, `2.5` or `"3"`, when config loads, then it is a `validation_error` naming `stacked_prs.max_slices`. | 4 | "`max_slices` values 10, 0, 2.5 and the string "3" each produce a `validation_error` naming `stacked_prs.max_slices`" | diff-local |
| Story 6 negative: Given a sliced plan with 10 slices (flag on or off), when land runs, then the `plan-slices` rung refuses it and names the bound 9. | 6 | "returns `invalid` for a ten-slice plan with a message containing `10` and `9`" | diff-local |
| Story 6 negative: Given an unknown sub-key under `stacked_prs`, when config loads, then the existing `validation_error` still names the key. | 4 | "an unknown sub-key `max_parallel` under `stacked_prs` still produces the `Unknown key in stacked_prs` validation_error" | diff-local |
| Story 7 happy: Given a merged eligible plan whose config is unchanged since land, when `coverage_binding` runs, then its ownership/eligibility layer passes and the step continues to its judge layer. | 12 | "for a merged eligible plan under unchanged config, passes the stacked-delivery layer and proceeds to its judge layer" | diff-local |
| Story 7 happy: Given an unsliced plan, or a sliced plan with the flag off, when `coverage_binding` runs, then the new layer is inert and the step's outcome equals today's. | 12 | "for an unsliced plan and for a sliced plan with `stacked_prs.enabled` false, the runner's result and written envelope equal those of today's runner" | diff-local |
| Story 7 negative: Given a sliced plan that landed with the flag off and has a story spanning slices 1 and 2, when the operator then enables `stacked_prs.enabled` and `coverage_binding` runs, then the step records `refused` and ends needs-human, naming the story and both positions. No task is appended and nothing routes to `plan`. | 12 | "records envelope status `refused` and returns refusal kind `needs-human` naming story `2` and positions `1` and `2`, with no task appended and no route to `plan`" | diff-local |
| Story 7 negative: Given a merged eligible plan, when the operator adds a custom step `after: test_suite` and `coverage_binding` runs, then it is refused needs-human, naming that step. | 12 | "adding custom `lint_gate` with `after: test_suite` after land" | diff-local |
| Story 7 negative: Given a merged eligible plan, when the operator lowers `max_slices` below the slice count, then `coverage_binding` is refused needs-human, naming the count and the bound. | 12 | "lowering `max_slices` to 1 for a 2-slice plan, each yield a `needs-human` refusal" | diff-local |
| Story 7 negative: Given a refusal at `coverage_binding`, when the halt is inspected, then the same predicate output is present that land would produce for the same plan and config (one owner). | 12, 10 | "the refusal reason equals the reason list `deriveStoryOwnership` and `evaluateStackEligibility` return for the same plan and config" | diff-local |
| Story 8 happy: Given an eligible plan, when `coverage_binding` passes, then its envelope records `story id → child position` beside the slice membership. | 14 | "writes `storyOwnership` `{ "1": 1, "2": 2 }` beside `sliceMembership` for an eligible plan" | diff-local |
| Story 8 happy: Given a recorded envelope, when `coverage_binding` is invalidated by an existing trigger and re-runs on an unchanged plan, then the recorded ownership is kept and is equal. | 14 | "a re-run after an existing invalidation trigger on the unchanged plan reads back an equal map" | diff-local |
| Story 8 negative: Given a recorded ownership, when the judge prompt is assembled, then it contains no ownership field. | 14 | "the judge dispatch payload assembled by the runner contains no `storyOwnership` data" | diff-local |
| Story 8 negative: Given a recorded ownership, when the completion status is evaluated, then ownership has no effect on it (`COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged). | 13 | "`COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged and an envelope's completion status is identical with and without `storyOwnership`" | diff-local |
| Story 8 negative: Given a recorded whole-feature baseline, when a projection for one child is computed through the provided feature-scope seam, then the stored baseline (membership plus ownership) is byte-identical before and after. | 15 | "the stored baseline (`sliceMembership` plus `storyOwnership`) serialized before and after the call is byte-identical" | diff-local |
| Story 8 negative: Given an unsliced or flag-off plan, when `coverage_binding` passes, then no ownership field is written. | 14 | "for an unsliced plan and for a flag-off sliced plan the written envelope has no `storyOwnership` field" | diff-local |
| Story 9 happy: Given `skills/plan/SKILL.md`, when it is read, then it instructs proposing a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on. On operator acceptance it writes `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md`. It states the one-story-per-child and single-id Story-line rules. | 16 | "instructs proposing a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on (slicing a Medium feature only when the operator asks), writing `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md` only on operator acceptance" | diff-local |
| Story 9 happy: Given the skill's documented example manifest and Story lines, when parsed by `validatePlanSlices` and the ownership predicate, then the result is `sliced` with no ownership violation. | 16 | "parses the skill's example manifest and Story lines with `validatePlanSlices` and `deriveStoryOwnership` requiring `sliced` with no ownership violation" | diff-local |
| Story 9 negative: Given the skill text, when it describes an operator decline, then it instructs authoring no manifest and writing no sign-off line. | 16 | "authoring no manifest and no sign-off line on decline" | diff-local |
| Story 9 negative: Given the skill's example sign-off line, when it is parsed by the sign-off parser, then it is recognized as approved. A drift test fails if the documented line and the parser disagree. | 16 | "parses the skill's example sign-off line with `parseStackedDeliverySignoff` requiring `approved`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D1 | task | task-9, task-12 | `landSpec` commits an unsliced plan with `stacked_prs.enabled: true` |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D2 | task | task-2, task-10, task-1 | yields one `story-spans-children` violation whose message names story `2` and positions `1` and `2` |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D3 | task | task-8, task-7 | `evaluateStackEligibility` returns `eligible` for tier `M` and for tier `L` |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D4 | task | task-3, task-16 | `parseStackedDeliverySignoff` returns `approved` for `Stacked-Delivery: approved` |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D5 | task | task-9, task-12, task-10, task-11, task-17 | commits the spec and raises no `stacked-delivery` error |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D6 | task | task-14, task-15, task-13 | writes `storyOwnership` `{ "1": 1, "2": 2 }` beside `sliceMembership` for an eligible plan |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D7 | task | task-4, task-6, task-5 | a drift test asserts the `plan-slices` grammar bound and the largest accepted `stacked_prs.max_slices` value are both no greater than `MAX_CHILD_ID` |
| adr-2026-09-29-plan-slice-manifest#D1 | existing | none | The `## Slices` table grammar (header cells Slice, Title, Tasks in `REQUIRED_HEADER`) is parsed by `validatePlanSlices` in `src/conductor/src/engine/plan-slices.ts`; this feature leaves the grammar unchanged. |
| adr-2026-09-29-plan-slice-manifest#D2 | task | task-2, task-8 | `deriveStoryOwnership` returns ownership `{ "1": 1, "2": 2 }` |
| adr-2026-09-29-plan-slice-manifest#D3 | task | task-6 | returns `invalid` for a ten-slice plan with a message containing `10` and `9` |
| adr-2026-09-29-plan-slice-manifest#D4 | existing | none | Strict `**Dependencies:**` validation for sliced plans is implemented in `validatePlanSlices` (`src/conductor/src/engine/plan-slices.ts`) and covered by `land-spec-plan-slices-dependencies.test.ts`; unchanged here. |
| adr-2026-09-29-plan-slice-manifest#D5 | task | task-9 | a sliced plan with a task in no slice fails with identifier `plan-slices` and not `stacked-delivery` |
| adr-2026-09-29-plan-slice-manifest#D6 | task | task-12, task-14 | records envelope status `refused` and returns refusal kind `needs-human` |
| adr-2026-09-29-plan-slice-manifest#D7 | existing | none | `plan_slices_changed` is a `ConductorEvent` member in `src/conductor/src/types/events.ts`; this feature emits no new event and leaves it unchanged. |
| adr-2026-09-29-plan-slice-manifest#D8 | task | task-4, task-5 | `CONFIG_CONSUMER_KEY_SETS.stacked_prs` equals `['enabled', 'max_slices']` |
| adr-2026-09-29-plan-slice-manifest#D9 | task | task-16 | parses the skill's example manifest and Story lines with `validatePlanSlices` and `deriveStoryOwnership` |
| adr-2026-08-31-coverage-binding-judge-step#D1 | task | task-14, task-15 | the judge dispatch payload assembled by the runner contains no `storyOwnership` data |
| adr-2026-08-31-coverage-binding-judge-step#D2 | no-change | none | This feature does not change quote scoping to `Done when` blocks. |
| adr-2026-08-31-coverage-binding-judge-step#D3 | no-change | none | This feature does not change tier-S criterion engagement at land. |
| adr-2026-08-31-coverage-binding-judge-step#D4 | no-change | none | This feature does not change the step's placement and judge inputs; the stacked-delivery layer runs before the judge and adds nothing to the judge payload. |
| adr-2026-08-31-coverage-binding-judge-step#D5 | no-change | none | This feature does not change the judge dispatch and its closed verdict. |
| adr-2026-08-31-coverage-binding-judge-step#D6 | no-change | none | This feature does not change the `does-not-assert` halt. |
| adr-2026-08-31-coverage-binding-judge-step#D7 | no-change | none | This feature does not change the `coverage_binding.judge.enabled` default and exit. |
| adr-2026-08-31-coverage-binding-judge-step#D8 | no-change | none | This feature does not change legacy tolerance for tasks without `Done when`. |
| adr-2026-08-31-coverage-binding-judge-step#D9 | no-change | none | This feature does not change its spine occurrences. |
| adr-2026-08-31-coverage-binding-judge-step#D10 | no-change | none | This feature does not change fail-row correction cells. |
| adr-2026-08-31-coverage-binding-judge-step#D11 | no-change | none | This feature does not change architecture correction citation rules. |
| adr-2026-08-31-coverage-binding-judge-step#D12 | no-change | none | This feature does not change per-batch judge dispatch. |
| adr-2026-08-31-coverage-binding-judge-step#D13 | no-change | none | This feature does not change batch digest-set validation. |
| adr-2026-08-31-coverage-binding-judge-step#D14 | no-change | none | This feature does not change atomic per-batch checkpointing. |
| adr-2026-08-31-coverage-binding-judge-step#D15 | no-change | none | This feature does not change `coverage_binding.judge.batch_size`. |
| adr-2026-08-31-coverage-binding-judge-step#D16 | no-change | none | This feature does not change the reseal void trigger, which the new layer relies on unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D17 | no-change | none | This feature does not change the ADR-obligation layer ordering; the new layer runs before it. |
| adr-2026-08-31-coverage-binding-judge-step#D18 | no-change | none | This feature does not change amendment-claim typing. |
| adr-2026-08-31-coverage-binding-judge-step#D19 | no-change | none | This feature does not change reopen-on-re-run semantics; recorded ownership is kept, not reopened. |
| adr-2026-08-31-coverage-binding-judge-step#D20 | no-change | none | This feature does not change its spine occurrences. |
| adr-2026-08-31-coverage-binding-judge-step#D21 | no-change | none | This feature does not change conflict-claim coverage. |
| adr-2026-08-31-coverage-binding-judge-step#D22 | no-change | none | This feature does not change conflict verdict validation. |
| adr-2026-08-31-coverage-binding-judge-step#D23 | no-change | none | This feature does not change conflict refusal behavior. |
| adr-2026-08-31-coverage-binding-judge-step#D24 | no-change | none | This feature does not change its spine occurrences. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | no-change | none | This feature does not change the single owner of branch identity. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | no-change | none | This feature does not change how branch consumers treat non-child inputs. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | no-change | none | This feature does not change the attribution-versus-authority rule. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | no-change | none | This feature does not change reserved branch namespaces. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | task | task-6, task-11, task-4 | `landSpec` with the flag on, `max_slices` absent and 2 slices throws `stacked-delivery` naming 2 slices and `stacked_prs.max_slices` = 1 |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | no-change | none | This feature does not change leaf branch kind. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | no-change | none | This feature does not change position immutability, which #2942 implements. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | no-change | none | This feature does not change per-child state layout. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | no-change | none | This feature does not change per-child region caps. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | no-change | none | This feature does not change active-child resolution, which #2942 implements. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | no-change | none | This feature does not change child base resolution, which #2942 implements. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | no-change | none | This feature does not change event child fields. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | no-change | none | This feature does not change the recovery CLIs and their `--child` flag. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | no-change | none | This feature does not change N=1 golden byte identity; the new layers are inert for unsliced and flag-off plans. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | no-change | none | This feature does not change running whole-feature rubrics once at the leaf. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
