# Implementation Plan: Sliced plans — story ownership and stack eligibility (#2941)

**Date:** 2026-10-07
**Design:** `.docs/decisions/adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility.md` (technical track, no PRD)
**Stories:** `.docs/stories/sliced-plans-can-be-landed-whose-stories-span-chil.md`
**Conflict check:** Clean as of 2026-10-07

## Summary

Adds story→child ownership and a single stack-eligibility verdict for sliced plans. Both are
enforced by a new land rung and re-checked at `coverage_binding` under the current config. Also adds
the `stacked_prs.max_slices` key, raises the grammar ceiling to `MAX_CHILD_ID`, records ownership in
the coverage-binding envelope, and teaches `/plan` to propose slices. 20 tasks.

## Technical Approach

- **Pure predicates, one owner.** `plan-slices.ts` gains three pure, model-free functions:
  - `deriveStoryOwnership(planText, slices)`: story → slice position, or typed violations
    `story-spans-children` and `multi-story-line`;
  - `customStepsInPerChildRegion(registry)`: region-coupled custom steps in a `buildStepRegistry` result. These are customs (names not in `ALL_STEPS`) whose resolved index lies strictly between `acceptance_specs` and `build_review`, plus BUILD-phase customs before `build_review` whose resolved `loopGate` or `kickbackTarget` is true. DECIDE-phase customs never count;
  - `evaluateStackEligibility(input)`: tier, sign-off, slice count against `max_slices`, and in-region
    customs, returning every reason.

  Land and the `coverage_binding` runner stay the only production importers of `plan-slices.ts`.
- **Parsing.**
  - `plan-task-parse.ts` gains `parsePlanTaskStoryLineIds`, which normalizes a `**Story:**` value in order: it drops parenthesized segments, drops text after ` — `, ` – `, ` - ` or `: `, splits on `,` `;` `/` `&` `+` and `and`, then strips a leading `Story`/`Stories`/`epic` word. `parsePlanTaskStoryIds` is untouched.
  - `deriveStoryOwnership` also takes the declared story ids (`splitStoryBlocks` over the stories artifact). It reports `unknown-story-id` for a non-infrastructure token that is not declared, and `story-unowned` for a declared story no task cites. A `**Type:** infrastructure|refactor` task whose tokens are not declared ids is a supporting-purpose task and owns nothing.
  - `artifacts.ts` gains `parseStackedDeliverySignoff`, modeled on `parseComplexityTier` /
    `parseTrack`: one case-insensitive `^\s*Stacked-Delivery:\s*(\S+)` line. It returns `approved`
    only for the value `approved`.
- **Engagement.** The new land rung `stacked-delivery` and the runner layer engage only when
  `validatePlanSlices` returns `sliced` **and** the resolved config has `stacked_prs.enabled === true`.
  - Land reads tier and sign-off from the worktree `.docs/complexity/<stem>.md`. It reads config
    with `loadConfig(projectRoot)` at evaluation time and builds the registry with `buildStepRegistry`. A sliced plan with a present-but-invalid config is refused.
  - The runner reads the complexity file by the selected plan's stem and uses its own
    a freshly loaded `loadConfig(this.projectDir)` and its own `buildStepRegistry` result, not the daemon's start-up config, so post-merge config drift is seen without a restart. A refusal leaves the envelope untouched.
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
3. Implement `parsePlanTaskStoryLineIds(text)` in `plan-task-parse.ts`. For each `**Story:**` line, normalize in this order: drop parenthesized segments; drop text after ` — `, ` – `, ` - ` or `: `; if what remains is exactly one non-story value (`n/a`, `none`, `prerequisite`, `all`, case-insensitive), the line yields no tokens. Otherwise split on `,` `;` `/` `&` `+` and the word `and`, strip a leading `Story`, `Stories` or `epic` word, and drop empty tokens. A non-story value mixed with ids stays a token. Leave `parsePlanTaskStoryIds` untouched.
4. Verify GREEN, then commit.

**Done when:**
- [test] `parsePlanTaskStoryLineIds` returns ids `["1","2"]` for `**Story:** 1, 2`, `["FR-1","FR-2"]` for `**Story:** FR-1 and FR-2`, and `["1"]` for `**Story:** Story 1`.
- [test] `parsePlanTaskStoryIds` still returns `["FR-1"]` for a task carrying `**Story:** FR-1, FR-2, FR-3`, and its existing tests pass unchanged.
- [test] `parsePlanTaskStoryLineIds` returns no ids for Story lines whose value is `n/a`, `N/A`, `none`, `prerequisite` or `all`, and returns `["1","n/a"]` for `**Story:** 1, n/a`.
- [test] `parsePlanTaskStoryLineIds` returns `["FR-14"]` for `**Story:** FR-14 (source=a, status=b) — happy path`, two ids each for `1/2`, `1 & 2`, `1; 2`, `1 + 2` and `Stories 1, 2`, and `["1-3"]` for `**Story:** 1-3`.
- [test] `parsePlanTaskStoryLineIds` drops text after ` – `, ` - ` and `: ` (each leaving `["1"]` for `1 – note`, `1 - note` and `1: note`) and strips a leading `epic` word (`epic E-2` gives `["E-2"]`).

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
3. Implement `parseStackedDeliverySignoff(content)` in `artifacts.ts` beside `parseComplexityTier`: a multiline, case-insensitive, line-anchored match that tolerates bold markers around the key and trailing punctuation after the value. Return `'approved'` only for the value `approved` (any case), and `'absent'` otherwise, including null content.
4. Verify GREEN, then commit.

**Done when:**
- [test] `parseStackedDeliverySignoff` returns `approved` for `Stacked-Delivery: approved` and for `stacked-delivery: APPROVED`.
- [test] `parseStackedDeliverySignoff` returns `absent` for content with no `Stacked-Delivery:` line and for `Stacked-Delivery: pending`.
- [test] `parseStackedDeliverySignoff` returns `approved` for a multi-line complexity artifact whose `Tier: L` line comes first and which later contains `**Stacked-Delivery:** approved.`.

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
   In the same change, add a `stacked_prs.max_slices` row to `src/conductor/test/engine/config-consumer-registry.ts` naming `src/conductor/src/engine/engineer/land-spec.ts` and `src/conductor/src/engine/step-runners.ts`, so the registry totality test stays green.
   Update the existing `stacked-prs-config.test.ts` assertions that this change breaks: the `toEqual({ enabled: … })` shapes now include `max_slices: 1`, the old "`max_slices` is an unknown key" case now uses `max_parallel`, and the key-set assertion becomes `['enabled', 'max_slices']`.
4. Verify GREEN, then commit.

**Done when:**
- [test] `loadConfig` resolves `stacked_prs.max_slices` to 1 when the key is absent and accepts integers 1 through 9, emitting a warning naming `stacked_prs.max_slices` for 7 and for 6, and no warning for 5.
- [test] `max_slices` values 10, 0, 2.5 and the string "3" each produce a `validation_error` naming `stacked_prs.max_slices`.
- [test] an unknown sub-key `max_parallel` under `stacked_prs` still produces the `Unknown key in stacked_prs` validation_error naming `max_parallel`, and `CONFIG_CONSUMER_KEY_SETS.stacked_prs` equals `['enabled', 'max_slices']`.

**Files likely touched:**
- `src/conductor/src/engine/config.ts` — validation, default, warning
- `src/conductor/src/types/config.ts` — `StackedPrsConfig.max_slices`
- `src/conductor/test/engine/stacked-prs-config.test.ts` — config tests
- `src/conductor/test/engine/config-consumer-registry.ts` — `max_slices` row

**Dependencies:** none

### Task 5: Consumer registry names the real readers of `stacked_prs`
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Change `src/conductor/test/engine/config-consumer-registry.ts` so its rows for `stacked_prs`, `stacked_prs.enabled` and `stacked_prs.max_slices` name `src/conductor/src/engine/engineer/land-spec.ts` and `src/conductor/src/engine/step-runners.ts` as consumers. This replaces the `none` reservation for #2724. Use the same consumer form as other multi-reader rows.
2. In `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts`, confirm (Tasks 8, 9 and 12 each widen it) the asserted set of production files that mention `stacked_prs` to `engine/config.ts`, `types/config.ts`, `engine/plan-slices.ts` (the eligibility reason names `stacked_prs.max_slices`), `engine/engineer/land-spec.ts` and `engine/step-runners.ts`.
3. Run the registry totality test (`config-consumer-registry.test.ts`) and the boundary test, and confirm both pass.
4. Commit.

**Done when:**
- [test] the config consumer registry declares `stacked_prs`, `stacked_prs.enabled` and `stacked_prs.max_slices` with `land-spec.ts` and `step-runners.ts` as consumers, no `none` row reserved for #2724 remains, and the registry totality test passes.
- `src/conductor/test/engine/config-consumer-registry.ts` contains no row for any `stacked_prs` key whose reason cites #2724.
- [test] `plan-slices-consumer-boundary.test.ts` asserts `stacked_prs` appears in exactly `engine/config.ts`, `types/config.ts`, `engine/plan-slices.ts`, `engine/engineer/land-spec.ts` and `engine/step-runners.ts`.

**Files likely touched:**
- `src/conductor/test/engine/config-consumer-registry.ts` — registry rows
- `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` — allowed `stacked_prs` readers

**Dependencies:** Task 4, Task 8, Task 9, Task 12

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
- [test] a ten-slice plan with one empty slice yields one `invalid` result naming both the bound and the empty slice, and `landSpec` with the flag off commits a nine-slice plan and a seven-slice plan, while `landSpec` refuses a ten-slice plan with identifier `plan-slices` naming the bound 9 both with the flag on and with it off.
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
3. Implement `customStepsInPerChildRegion(registry)` in `plan-slices.ts`. It returns, in registry order, `{ name, coupling }` entries (`coupling` is `in-region` or `loop-coupled`) for entries not in `ALL_STEPS` that are region-coupled: either the index lies strictly between the indices of `acceptance_specs` and `build_review`, or it is a BUILD-phase entry before `build_review` whose resolved `loopGate` or `kickbackTarget` is true. DECIDE-phase customs are never returned. It classifies by resolved registry entries, never by `after` text. Custom-step fixtures need a `skill` pointing at an existing SKILL.md file, because `buildStepRegistry` drops a custom step without `skill` or `parallel` and the config validator checks that the skill file exists.
4. Verify GREEN, then commit.

**Done when:**
- [test] for registries built by `buildStepRegistry` with customs `after: explore`, `after: coverage_binding` or `after: build_review`, `customStepsInPerChildRegion` returns an empty list.
- [test] a custom `lint_gate` with `after: test_suite` yields `lint_gate` with coupling `in-region`, and customs `a` (`after: build`) and `b` (`after: a`) yield `a` and `b`, both `in-region`.
- [test] customs `prep` with `after: coverage_binding` plus `kickback_target: true`, and `prep2` with `after: coverage_binding` plus `gate: true`, are both returned with coupling `loop-coupled`, while a plain `after: coverage_binding` custom, `after: explore` customs with `gate: true` or `kickback_target: true`, and an `after: build_review` custom with `gate: true` are not.
- [test] a custom `spec_lint` with `after: acceptance_specs` yields `spec_lint` with coupling `in-region`.
- [test] a custom whose `after` target does not resolve is absent from the returned list, and `loadConfig` for that config still returns the existing validation error naming the unresolved `after` target.

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
3. Implement `evaluateStackEligibility({ tier, signoff, slicePositions, maxSlices, regionCoupledSteps, complexityPath })`, where `regionCoupledSteps` is the classifier's `{ name, coupling }` list, in `plan-slices.ts`. It returns `{ kind: 'eligible' }` or `{ kind: 'ineligible', reasons }` listing every reason. A position above `MAX_CHILD_ID` is a reason.
   Because this task adds the token `stacked_prs` to `engine/plan-slices.ts`, add that file to the allowed `stacked_prs` set in `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` in the same commit, so the suite stays green.
4. Verify GREEN, then commit.

**Done when:**
- [test] `evaluateStackEligibility` returns `eligible` for tier `M` and for tier `L` with sign-off `approved`, 2 slices with `maxSlices` 2, and no in-region custom.
- [test] tier `S` yields a reason naming tier `S` and stating stacked delivery requires tier M or L, an absent sign-off yields a reason stating no operator stacking sign-off is recorded in the given complexity path, and tier `S` with absent sign-off yields both reasons.
- [test] 2 slices with `maxSlices` 1 yield a reason naming 2 slices and `stacked_prs.max_slices` = 1, and an in-region custom `lint_gate` yields a reason naming `lint_gate` as inside the per-child region.
- [test] a slice at position 12 yields a reason naming position `12` above the `MAX_CHILD_ID` ceiling of 9, a missing tier yields the same tier-M-or-L reason as tier `S`, and a `loop-coupled` custom `prep` yields a reason naming `prep` as coupled to the per-child loop.
- [test] `customStepsInPerChildRegion`, `deriveStoryOwnership` and `evaluateStackEligibility` are exported from `plan-slices.ts` and perform no filesystem access (asserted with a filesystem spy that records zero calls).

**Files likely touched:**
- `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` — allow `engine/plan-slices.ts`
- `src/conductor/src/engine/plan-slices.ts` — verdict
- `src/conductor/test/engine/plan-slices-eligibility.test.ts` — verdict tests

**Dependencies:** Task 2, Task 7

### Task 9: Land rung `stacked-delivery`: wiring and engagement
**Story:** Story 3, Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts`. Write each fixture project's `stacked_prs` and `steps` settings to its canonical `.ai-conductor/config.yml`, which is what land reads. Do not use `ownerConfig` for them. Do not mock `plan-slices`: the real predicates must run.
2. Verify RED.
3. Implement in `land-spec.ts`:
   - add `'stacked-delivery'` to `LandGateIdentifier`;
   - after the `plan-slices` rung and the stories reference, approval and readability rungs, and before the coherence gate, when the slice result is `sliced`, load the project config with `loadConfig(canonical)`. If a project config is present but invalid, throw `landGateError('stacked-delivery', …)` naming the config error. A missing config is the flag-off default. When `stacked_prs.enabled === true`, resolve the complexity file with the same `pickIdeaFile(complexityDir, featureFiles)` the tier check uses, and the declared story ids with `splitStoryBlocks` over the already-read stories artifact. Do not use the token `Slices` in new `land-spec.ts` code: `plan-slices-consumer-boundary.test.ts` reserves it to `plan-slices.ts`;
   - call `deriveStoryOwnership` and `evaluateStackEligibility`, with `customStepsInPerChildRegion(buildStepRegistry(config))`;
   - throw `landGateError('stacked-delivery', …)` joining every reason.

   Otherwise skip the rung entirely.
   Because this task adds the token `stacked_prs` to `engine/engineer/land-spec.ts`, add that file to the allowed `stacked_prs` set in `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` in the same commit, so the suite stays green.
4. Verify GREEN, then commit.

**Done when:**
- [test] `landSpec` on an eligible baseline (tier L, `Stacked-Delivery: approved`, 2 slices, `max_slices: 2`, single-owner stories) commits the spec and raises no `stacked-delivery` error, with single-id Story lines written both bare (`**Story:** 1`) and prefixed (`**Story:** Story 1`).
- [test] `landSpec` commits an eligible baseline whose slice 2 also holds a task with no Story line and a task with `**Story:** n/a`.
- [test] `landSpec` commits an unsliced plan with `stacked_prs.enabled: true` with the same commit message and committed paths as for that plan with the flag off, which are the pre-change values already asserted by the unmodified existing `land-spec.test.ts` unsliced-plan tests, and commits a flag-off sliced plan whose story spans two slices, whose tier is `S` and which has no sign-off, with the `stacked-delivery` rung not evaluated in either case.
- [test] `landSpec` also commits that spanning, tier-`S`, unsigned sliced plan when the project config has no `stacked_prs` block at all.
- [test] with the flag off, a sliced plan with a task in no slice fails with identifier `plan-slices` and not `stacked-delivery`, and a three-slice plan with no `max_slices` commits.

**Files likely touched:**
- `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` — allow `engine/engineer/land-spec.ts`
- `src/conductor/src/engine/engineer/land-spec.ts` — rung
- `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` — land tests

**Dependencies:** Task 2, Task 3, Task 6, Task 8, Task 18

### Task 10: Land refuses ownership violations
**Story:** Story 1, Story 2
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts`. Type the multi-id fixture tasks `**Type:** happy-path`, so the infrastructure supporting-purpose exemption cannot apply.
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
3. Implement in the `coverage_binding` runner (`step-runners.ts`), after the existing slice layer and before the ADR/judge layers. Add an optional `projectRoot` field to `StepRunnerOptions` (defaulting to the runner's project directory), and have `daemon-cli.ts` pass its own project root when it constructs `DefaultStepRunner` for a feature worktree. When the slice result is `sliced`, load `loadConfig(this.projectRoot)` fresh (not `this.config`, and never the worktree's copy), before any envelope write in this run. A `missing` result is the flag-off default. Any other load failure falls back to `this.config`, so today's outcome is preserved. When that result has `stacked_prs.enabled === true`:
   - read `.docs/complexity/<plan stem>.md`;
   - call `deriveStoryOwnership` (with declared story ids from `splitStoryBlocks` over the DECIDE set's stories path; do not use the token `Slices` in new runner code) and `evaluateStackEligibility`, with `customStepsInPerChildRegion(buildStepRegistry(freshConfig))` and its `max_slices`;
   - on any reason, return `{ success: false, refusal: { kind: 'needs-human', reason } }` **without writing the envelope**, where `reason` lists every predicate reason.

   It never appends a task or routes to `plan`. Otherwise the layer is inert.
   Because this task adds the token `stacked_prs` to `engine/step-runners.ts`, add that file to the allowed `stacked_prs` set in `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` in the same commit, so the suite stays green.
4. Verify GREEN, then commit.

**Done when:**
- [test] the `coverage_binding` runner, for a merged eligible plan under unchanged config, passes the stacked-delivery layer and proceeds to its judge layer.
- [test] for an unsliced plan and for a sliced plan with `stacked_prs.enabled` false, the runner's result and written envelope equal those of today's runner, the flag being read only to leave the layer inert.
- [test] a sliced plan with story 2 spanning slices 1 and 2, run after the flag is turned on post-land, returns refusal kind `needs-human` naming story `2` and positions `1` and `2`, leaves the envelope file byte-identical, appends no task and does not route to `plan`.
- [test] adding custom `lint_gate` with `after: test_suite` after land, or lowering `max_slices` to 1 for a 2-slice plan, each yield a `needs-human` refusal naming `lint_gate`, or naming 2 slices and `stacked_prs.max_slices` = 1, read from a freshly loaded `loadConfig` and `buildStepRegistry`.
- [test] the refusal reason equals the reason list `deriveStoryOwnership` and `evaluateStackEligibility` return for the same plan and config, and the halt written through the existing needs-human refusal path carries that same reason text.

**Files likely touched:**
- `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` — allow `engine/step-runners.ts`
- `src/conductor/src/engine/step-runners.ts` — runner layer and `projectRoot` option
- `src/conductor/src/daemon-cli.ts` — pass the project root to the runner
- `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts` — runner tests

**Dependencies:** Task 2, Task 3, Task 4, Task 8, Task 18

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
- [test] the `coverage_binding` runner writes `storyOwnership` `{ "1": 1, "2": 2 }` beside `sliceMembership` for an eligible plan, and after an existing invalidation trigger the invalidated envelope, read before the re-run, still carries that `storyOwnership` map, and the envelope written by the re-run on the unchanged plan carries an equal `storyOwnership` map.
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
3. Implement pure `projectChildOwnership(envelope, position)` in `coverage-binding-envelope.ts`. It returns that position's task ids and owned story ids, and never mutates or writes the envelope. Make the existing `task … --child <k>` membership check in `task-cli.ts` decide membership through it (a task is a member when it is in the projection's task ids), keeping its messages unchanged. The owning child named in the rejection message still comes from `sliceMembership.taskSlices`.
4. Verify GREEN, then commit.

**Done when:**
- [test] `projectChildOwnership` returns the stories and tasks owned by the given position, and the stored baseline (`sliceMembership` plus `storyOwnership`) serialized before and after the call is byte-identical.
- `projectChildOwnership` is a pure function in `coverage-binding-envelope.ts` with no filesystem access.
- [test] `ai-conductor task start <id> --child <k>` decides membership through `projectChildOwnership`, rejecting a task recorded in another child with the existing message naming its owning child, and the existing task-cli `--child` tests pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/coverage-binding-envelope.ts` — projection
- `src/conductor/test/engine/coverage-binding-envelope.test.ts` — projection test
- `src/conductor/src/engine/task-cli.ts` — membership via projection

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

   Keep the example manifest valid, and give its example tasks single-id `**Story:**` lines so the ownership check is exercised.
4. Verify GREEN, then commit.

**Done when:**
- `skills/plan/SKILL.md` instructs proposing a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on (slicing a Medium feature only when the operator asks), writing `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md` only on operator acceptance, and authoring no manifest and no sign-off line on decline.
- `skills/plan/SKILL.md` states the one-story-per-child rule, the single-id `**Story:**` line rule, and the grammar bound of 9 with stacking bounded by `stacked_prs.max_slices`.
- [test] `plan-slices-skill-contract.test.ts` parses the skill's example manifest and Story lines with `validatePlanSlices` and `deriveStoryOwnership` requiring `sliced` with no ownership violation and at least two owned stories, and parses the skill's example sign-off line with `parseStackedDeliverySignoff` requiring `approved`.

**Files likely touched:**
- `skills/plan/SKILL.md` — slice proposal and authoring rules
- `src/conductor/test/engine/plan-slices-skill-contract.test.ts` — drift test

**Dependencies:** Task 2, Task 3, Task 6, Task 18

### Task 17: Stacked-delivery refusals are ordered, non-waivable and pre-judge
**Story:** Story 7, Story 1
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` and `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts`.
2. Verify RED, then make GREEN. The land rung must run after `plan-slices` and consult no waiver parser. The runner layer must return before any judge dispatch.
3. Commit.

**Done when:**
- [test] `landSpec` on a sliced, flag-on plan that has both a task in no slice and a story spanning two slices fails with identifier `plan-slices`, so the `stacked-delivery` rung runs only after `plan-slices` passes.
- [test] `landSpec` with a `.docs/coherence-waivers/<stem>.md` file naming the spanning story throws `stacked-delivery` before the coherence gate runs (a coherence-gate spy records zero calls), so no waiver bypasses the rung.
- [test] a `coverage_binding` run refused by the stacked-delivery layer makes zero calls to the judge dispatcher mock.
- [test] `landSpec` reads `stacked_prs` from the canonical checkout's `.ai-conductor/config.yml`, not the per-idea worktree's copy: with the flag on at the canonical root and off in the worktree, a spanning story is refused.
- [test] `landSpec` on a sliced plan with a present but invalid project config (`stacked_prs.max_slices: 12`) throws `stacked-delivery` naming the config error, while an unsliced plan with the same config lands as it does today.

**Files likely touched:**
- `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` — ordering and waiver tests
- `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts` — pre-judge test

**Dependencies:** Task 10, Task 12

### Task 18: Ownership validates tokens against the declared stories
**Story:** Story 2, Story 1
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/plan-slices-ownership.test.ts`, passing declared story ids explicitly.
2. Verify RED.
3. Extend `deriveStoryOwnership(planText, slices, declaredStoryIds)`, updating Task 2's fixtures to declare their stories:
   - a task whose `**Type:**` is `infrastructure` or `refactor` and none of whose tokens is a declared id is a supporting-purpose task and owns nothing, even when its line splits into several tokens, so no `multi-story-line` violation is raised for it;
   - any other task's undeclared token is an `unknown-story-id` violation naming the task and token;
   - a declared story that no task cites is a `story-unowned` violation naming the story.

   Every violation is reported.
4. Verify GREEN, then commit.

**Done when:**
- [test] with declared stories `1` and `2`, a `**Type:** happy-path` task citing `**Story:** 1-3` yields an `unknown-story-id` violation naming the task and the token `1-3`.
- [test] a `**Type:** infrastructure` task and a `**Type:** refactor` task whose Story line is `repo release gate (shared helper)` each own no story and yield no violation, while the same line on a `**Type:** happy-path` task yields `unknown-story-id`.
- [test] a declared story `3` cited by no task yields a `story-unowned` violation naming story `3`, and a `**Type:** infrastructure` task with Story line `release gate and config` yields no violation.
- [test] `**Story:** 1 (source=a, status=b) — happy path` on a task in slice 1 is read as the single story `1` and yields no violation, while `**Story:** 1, n/a` on a `**Type:** happy-path` task yields a `multi-story-line` violation.

**Files likely touched:**
- `src/conductor/src/engine/plan-slices.ts` — declared-id validation
- `src/conductor/test/engine/plan-slices-ownership.test.ts` — validation tests

**Dependencies:** Task 2

### Task 19: A build-entry refusal keeps the baseline and reads fresh config
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts`. For the freshness test, construct the runner with a config whose flag is off, then rewrite the fixture's `.ai-conductor/config.yml` to turn it on.
2. Verify RED, then make GREEN through the Task 12 layer.
3. Commit.

**Done when:**
- [test] after a stacked-delivery refusal over a previously `invalidated` envelope with entries, the envelope file is byte-identical, and the next `coverage_binding` run after the cause is fixed treats that envelope as reopen-eligible and reopens per D19 exactly as a run without the refusal does.
- [test] a runner constructed with `stacked_prs.enabled` false, with its project directory a feature worktree distinct from `projectRoot`, run after the `projectRoot` `.ai-conductor/config.yml` is changed to `enabled: true` (the worktree copy left at `false`), evaluates the layer with the new value and refuses a sliced plan whose story spans slices 1 and 2.
- [test] when the fresh `loadConfig(projectRoot)` fails validation the layer evaluates with the runner's start-up config, and `landSpec` with no `.ai-conductor/config.yml` at all treats the flag as off and commits a sliced plan whose story spans two slices.
- [test] a runner constructed with no `projectRoot` option, whose project directory has no `.ai-conductor/config.yml`, treats the flag as off and leaves the layer inert.
- [test] `daemon-cli.ts` constructs `DefaultStepRunner` with `projectRoot` set to the daemon's project root, so land and `coverage_binding` read the same root `.ai-conductor/config.yml`.

**Files likely touched:**
- `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts` — baseline and freshness tests
- `src/conductor/test/daemon-cli-runner-project-root.test.ts` — runner `projectRoot` wiring

**Dependencies:** Task 9, Task 12

### Task 20: Land refuses loop-coupled customs, undeclared and unowned stories, and split Story lines
**Story:** Story 5, Story 1, Story 2
**Type:** negative-path

**Steps:**
1. Add failing tests to `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts`, with config in the fixture's `.ai-conductor/config.yml` and the real predicates (no mock).
2. Verify RED, then make GREEN through the Task 9 rung.
3. Commit.

**Done when:**
- [test] `landSpec` with custom `prep` `after: coverage_binding` and `kickback_target: true`, and separately with `gate: true`, throws `stacked-delivery` naming `prep` as coupled to the per-child loop.
- [test] `landSpec` whose stories file declares story `3` cited by no task throws `stacked-delivery` naming story `3` as owned by no child.
- [test] `landSpec` with `**Story:** 1/2` on one task and `**Story:** 1 & 2` on another throws one `stacked-delivery` error reporting a `multi-story-line` violation for each task.
- [test] `landSpec` with a `**Type:** happy-path` task citing `**Story:** 1-3`, where no story `1-3` is declared, throws `stacked-delivery` naming the task and token `1-3` as an unknown story id.
- [test] `landSpec` commits an eligible baseline whose task carries `**Story:** 1 (source=a, status=b) — happy path` and whose slice 2 holds a `**Type:** infrastructure` task with Story line `repo release gate (shared helper)`.

**Files likely touched:**
- `src/conductor/test/engine/engineer/land-spec-stacked-delivery.test.ts` — refusal tests

**Dependencies:** Task 7, Task 9, Task 18

## Task Dependency Graph

```
1 ──► 2 ──┬──────────────► 9 ──┬──► 10
3 ────────┤                    ├──► 11
4 ──► 6 ──┤                    │
7 ──► 8 ──┴──► 12 ──► 14
13 ──────────────────► 14
13 ──► 15
10, 12 ──► 17
2 ──► 18 ──► 9, 12, 16, 20 (20 also needs 7, 9)
12 ──► 19
4, 8, 9, 12 ──► 5
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
| Story 1 negative: Given an eligible baseline whose stories file declares story `3` but no task cites story `3`, when land runs, then land fails with gate `stacked-delivery`, and the message names story `3` as owned by no child. | 20, 18 | "`landSpec` whose stories file declares story `3` cited by no task throws `stacked-delivery` naming story `3` as owned by no child" | diff-local |
| Story 2 happy: Given an eligible baseline whose every `**Story:**` line carries exactly one id (with or without a `Story ` prefix), when land runs, then the spec commits. | 9 | "with single-id Story lines written both bare (`**Story:** 1`) and prefixed (`**Story:** Story 1`)" | diff-local |
| Story 2 happy: Given an eligible baseline whose task carries `**Story:** 1 (source=a, status=b) — happy path`, when land runs, then the line is read as the single story `1` and the spec commits. | 20, 1, 18 | "`landSpec` commits an eligible baseline whose task carries `**Story:** 1 (source=a, status=b) — happy path`" | diff-local |
| Story 2 happy: Given an eligible baseline with a `**Type:** infrastructure` task in slice 2 whose Story line is a supporting-purpose statement such as `repo release gate (shared helper)`, when land runs, then that task owns no story and the spec commits. | 20, 18 | "whose slice 2 holds a `**Type:** infrastructure` task with Story line `repo release gate (shared helper)`" | diff-local |
| Story 2 negative: Given an eligible baseline except that task `T2` carries `**Story:** 1, 2`, when land runs, then land fails with gate `stacked-delivery`, and the message names task `T2` and the line text. Story `2` is not silently dropped. | 10 | "with `**Story:** 1, 2` on T2 throws `stacked-delivery` naming task `T2` and the line text" | diff-local |
| Story 2 negative: Given an eligible baseline except that task `T4` carries `**Story:** FR-1 and FR-2`, when land runs, then the same `multi-story-line` refusal names task `T4`. | 10 | "with `**Story:** FR-1 and FR-2` on T4 throws `stacked-delivery` naming task `T4`" | diff-local |
| Story 2 negative: Given an eligible baseline except that one task carries `**Story:** 1/2` and another carries `**Story:** 1 & 2`, when land runs, then one refusal reports a `multi-story-line` violation for each task, and neither line is truncated to its first id. | 20, 1 | "`landSpec` with `**Story:** 1/2` on one task and `**Story:** 1 & 2` on another throws one `stacked-delivery` error reporting a `multi-story-line` violation for each task" | diff-local |
| Story 2 negative: Given an eligible baseline except that a `**Type:** happy-path` task carries `**Story:** 1-3`, and the stories file declares no story `1-3`, when land runs, then land fails with gate `stacked-delivery`, and the message names the task and the token `1-3` as an unknown story id. | 20, 18 | "`landSpec` with a `**Type:** happy-path` task citing `**Story:** 1-3`, where no story `1-3` is declared, throws `stacked-delivery` naming the task and token `1-3` as an unknown story id" | diff-local |
| Story 2 negative: Given an **unsliced** plan whose task carries `**Story:** FR-1, FR-2, FR-3`, when land runs, then no multi-story-line refusal is raised and `parsePlanTaskStoryIds` still returns `["FR-1"]` for that task, as it does today. | 1, 10 | "`parsePlanTaskStoryIds` still returns `["FR-1"]` for a task carrying `**Story:** FR-1, FR-2, FR-3`" | diff-local |
| Story 3 happy: Given an unsliced plan in a project with `stacked_prs.enabled: true`, when land runs, then no `stacked-delivery` check runs, and land's outcome equals the outcome before this change. | 9 | "`landSpec` commits an unsliced plan with `stacked_prs.enabled: true`" | diff-local |
| Story 3 happy: Given a sliced plan with the flag off (or no `stacked_prs` block) whose story spans two slices, whose tier is `S`, and that has no sign-off, when land runs, then it commits. Only the existing `plan-slices` grammar rung applies. | 9 | "commits a flag-off sliced plan whose story spans two slices, whose tier is `S` and which has no sign-off" | diff-local |
| Story 3 negative: Given a sliced plan with the flag off that is malformed under the existing grammar (a task in no slice), when land runs, then it still fails with the existing gate `plan-slices` and not with `stacked-delivery`. | 9 | "a sliced plan with a task in no slice fails with identifier `plan-slices` and not `stacked-delivery`" | diff-local |
| Story 3 negative: Given the flag off and `stacked_prs.max_slices` absent, when a sliced plan with 3 slices lands, then it commits. The default `max_slices` of 1 does not refuse it, because `max_slices` applies only through stack eligibility. | 9 | "a three-slice plan with no `max_slices` commits" | diff-local |
| Story 3 negative: Given a sliced plan and a project config that is present but invalid (for example `stacked_prs.max_slices: 12`), when land runs, then land fails with gate `stacked-delivery`, and the message names the config error. Given an unsliced plan with the same invalid config, land behaves exactly as today. | 17 | "`landSpec` on a sliced plan with a present but invalid project config (`stacked_prs.max_slices: 12`) throws `stacked-delivery` naming the config error, while an unsliced plan with the same config lands as it does today" | diff-local |
| Story 4 happy: Given an eligible baseline with `Tier: M` and `Stacked-Delivery: approved`, when land runs, then it commits. | 11 | "`landSpec` on an eligible baseline with `Tier: M` commits" | diff-local |
| Story 4 happy: Given a complexity artifact containing `stacked-delivery: APPROVED` in a different letter case, when the sign-off is parsed, then it is recognized as approved. | 3 | "`parseStackedDeliverySignoff` returns `approved` for `Stacked-Delivery: approved` and for `stacked-delivery: APPROVED`" | diff-local |
| Story 4 happy: Given a multi-line complexity artifact whose `Tier: L` line comes first and which later contains `**Stacked-Delivery:** approved.` (bold key, trailing period), when the sign-off is parsed, then it is recognized as approved. | 3 | "returns `approved` for a multi-line complexity artifact whose `Tier: L` line comes first and which later contains `**Stacked-Delivery:** approved.`" | diff-local |
| Story 4 negative: Given an eligible baseline except `Tier: S`, when land runs, then land fails with gate `stacked-delivery`, and the message says stacked delivery requires tier M or L and names tier `S`. | 11 | "with `Tier: S` throws `stacked-delivery` naming tier `S` and requiring tier M or L" | diff-local |
| Story 4 negative: Given an eligible baseline whose complexity artifact has no `Stacked-Delivery:` line, when land runs, then land fails, and the message says no operator stacking sign-off is recorded in `.docs/complexity/<stem>.md`. | 11 | "with no `Stacked-Delivery:` line, or with `Stacked-Delivery: pending`, throws `stacked-delivery` stating no operator stacking sign-off is recorded in `.docs/complexity/<stem>.md`" | diff-local |
| Story 4 negative: Given `Stacked-Delivery: pending` (any value other than `approved`), when land runs, then it is treated as no sign-off and refused with the same message. | 11 | "or with `Stacked-Delivery: pending`, throws `stacked-delivery` stating no operator stacking sign-off is recorded" | diff-local |
| Story 4 negative: Given a stacked candidate that is both tier `S` and unsigned, when land runs, then one refusal lists both reasons. | 11 | "tier `S` with no sign-off throws one error listing both reasons" | diff-local |
| Story 5 happy: Given an eligible baseline whose config has a custom step `after: explore` (DECIDE), when land runs, then it commits. | 11 | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| Story 5 happy: Given an eligible baseline whose config has a custom step `after: build_review`, when land runs, then it commits. | 11 | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| Story 5 happy: Given an eligible baseline whose config has a custom step `after: coverage_binding` (before `acceptance_specs`), when land runs, then it commits. | 11 | "customs after `explore`, `coverage_binding` or `build_review` commit" | diff-local |
| Story 5 negative: Given an eligible baseline whose config has custom step `lint_gate` with `after: test_suite`, when land runs, then land fails with gate `stacked-delivery`, and the message names `lint_gate` as inside the per-child region. | 11, 8 | "`landSpec` with custom `lint_gate` `after: test_suite` throws `stacked-delivery` naming `lint_gate`" | diff-local |
| Story 5 negative: Given custom step `a` with `after: build` and custom step `b` with `after: a`, when land runs, then the refusal names both `a` and `b`. | 11 | "customs `a` (`after: build`) and `b` (`after: a`) are both named" | diff-local |
| Story 5 negative: Given an eligible baseline whose config has custom step `prep` with `after: coverage_binding` and `kickback_target: true`, or with `gate: true`, when land runs, then land fails with gate `stacked-delivery`, and the message names `prep` as coupled to the per-child loop. | 20, 7 | "`landSpec` with custom `prep` `after: coverage_binding` and `kickback_target: true`, and separately with `gate: true`, throws `stacked-delivery` naming `prep` as coupled to the per-child loop" | diff-local |
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
| Story 7 negative: Given a sliced plan that landed with the flag off and has a story spanning slices 1 and 2, when the operator then enables `stacked_prs.enabled` and `coverage_binding` runs, then the step ends needs-human, naming the story and both positions. The coverage-binding envelope file is byte-identical before and after the run, no task is appended, and nothing routes to `plan`. | 12 | "returns refusal kind `needs-human` naming story `2` and positions `1` and `2`, leaves the envelope file byte-identical, appends no task and does not route to `plan`" | diff-local |
| Story 7 negative: Given a previously `invalidated` envelope with entries, when the stacked-delivery layer refuses and the operator then fixes the cause and `coverage_binding` re-runs, then that re-run still treats the prior envelope as reopen-eligible (D19), exactly as it would have without the refusal. | 19 | "treats that envelope as reopen-eligible and reopens per D19 exactly as a run without the refusal does" | diff-local |
| Story 7 negative: Given a daemon started with `stacked_prs.enabled` false, when the operator turns the flag on in the project config and `coverage_binding` next runs for a sliced plan with a spanning story, then the layer sees the new value and refuses without a daemon restart. | 19 | "run after the `projectRoot` `.ai-conductor/config.yml` is changed to `enabled: true` (the worktree copy left at `false`), evaluates the layer with the new value and refuses a sliced plan whose story spans slices 1 and 2" | diff-local |
| Story 7 negative: Given a merged eligible plan, when the operator adds a custom step `after: test_suite` and `coverage_binding` runs, then it is refused needs-human, naming that step. | 12 | "adding custom `lint_gate` with `after: test_suite` after land" | diff-local |
| Story 7 negative: Given a merged eligible plan, when the operator lowers `max_slices` below the slice count, then `coverage_binding` is refused needs-human, naming the count and the bound. | 12 | "lowering `max_slices` to 1 for a 2-slice plan, each yield a `needs-human` refusal" | diff-local |
| Story 7 negative: Given a refusal at `coverage_binding`, when the halt is inspected, then the same predicate output is present that land would produce for the same plan and config (one owner). | 12, 10 | "the refusal reason equals the reason list `deriveStoryOwnership` and `evaluateStackEligibility` return for the same plan and config" | diff-local |
| Story 8 happy: Given an eligible plan, when `coverage_binding` passes, then its envelope records `story id → child position` beside the slice membership. | 14 | "writes `storyOwnership` `{ "1": 1, "2": 2 }` beside `sliceMembership` for an eligible plan" | diff-local |
| Story 8 happy: Given a recorded envelope, when `ai-conductor task start <id> --child <k>` runs for a task recorded in a different child, then it is rejected naming the task's owning child, exactly as today. | 15 | "`ai-conductor task start <id> --child <k>` decides membership through `projectChildOwnership`, rejecting a task recorded in another child with the existing message naming its owning child" | diff-local |
| Story 8 happy: Given a recorded envelope, when `coverage_binding` is invalidated by an existing trigger and re-runs on an unchanged plan, then the recorded ownership is kept and is equal. | 14 | "after an existing invalidation trigger the invalidated envelope, read before the re-run, still carries that `storyOwnership` map" | diff-local |
| Story 8 negative: Given a recorded ownership, when the judge prompt is assembled, then it contains no ownership field. | 14 | "the judge dispatch payload assembled by the runner contains no `storyOwnership` data" | diff-local |
| Story 8 negative: Given a recorded ownership, when the completion status is evaluated, then ownership has no effect on it (`COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged). | 13 | "`COVERAGE_BINDING_COMPLETION_STATUSES` is unchanged and an envelope's completion status is identical with and without `storyOwnership`" | diff-local |
| Story 8 negative: Given a recorded whole-feature baseline, when a projection for one child is computed through the provided feature-scope seam, then the stored baseline (membership plus ownership) is byte-identical before and after. | 15 | "the stored baseline (`sliceMembership` plus `storyOwnership`) serialized before and after the call is byte-identical" | diff-local |
| Story 8 negative: Given an unsliced or flag-off plan, when `coverage_binding` passes, then no ownership field is written. | 14 | "for an unsliced plan and for a flag-off sliced plan the written envelope has no `storyOwnership` field" | diff-local |
| Story 9 happy: Given `skills/plan/SKILL.md`, when it is read, then it instructs proposing a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on. On operator acceptance it writes `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md`. It states the one-story-per-child and single-id Story-line rules. | 16 | "instructs proposing a `## Slices` manifest for Large features only when `stacked_prs.enabled` is on (slicing a Medium feature only when the operator asks), writing `Stacked-Delivery: approved` into `.docs/complexity/<stem>.md` only on operator acceptance" | diff-local |
| Story 9 happy: Given the skill's documented example manifest and Story lines, when parsed by `validatePlanSlices` and the ownership predicate, then the result is `sliced` with no ownership violation. | 16 | "parses the skill's example manifest and Story lines with `validatePlanSlices` and `deriveStoryOwnership`" | diff-local |
| Story 9 negative: Given the skill text, when it describes an operator decline, then it instructs authoring no manifest and writing no sign-off line. | 16 | "authoring no manifest and no sign-off line on decline" | diff-local |
| Story 9 negative: Given the skill's example sign-off line, when it is parsed by the sign-off parser, then it is recognized as approved. A drift test fails if the documented line and the parser disagree. | 16 | "parses the skill's example sign-off line with `parseStackedDeliverySignoff` requiring `approved`" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D1 | task | task-9, task-12 | `landSpec` commits an unsliced plan with `stacked_prs.enabled: true` |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D2 | task | task-2, task-10, task-1, task-18, task-20 | yields one `story-spans-children` violation whose message names story `2` and positions `1` and `2` |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D3 | task | task-8, task-7, task-20 | `evaluateStackEligibility` returns `eligible` for tier `M` and for tier `L` |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D4 | task | task-3, task-16 | `parseStackedDeliverySignoff` returns `approved` for `Stacked-Delivery: approved` |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D5 | task | task-9, task-12, task-10, task-11, task-17, task-19 | commits the spec and raises no `stacked-delivery` error |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D6 | task | task-14, task-15, task-13 | writes `storyOwnership` `{ "1": 1, "2": 2 }` beside `sliceMembership` for an eligible plan |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D7 | task | task-4, task-6, task-5 | a drift test asserts the `plan-slices` grammar bound and the largest accepted `stacked_prs.max_slices` value are both no greater than `MAX_CHILD_ID` |
| adr-2026-09-29-plan-slice-manifest#D1 | existing | none | The `## Slices` table grammar (header cells Slice, Title, Tasks in `REQUIRED_HEADER`) is parsed by `validatePlanSlices` in `src/conductor/src/engine/plan-slices.ts`; this feature leaves the grammar unchanged. |
| adr-2026-09-29-plan-slice-manifest#D2 | task | task-2, task-8 | `deriveStoryOwnership` returns ownership `{ "1": 1, "2": 2 }` |
| adr-2026-09-29-plan-slice-manifest#D3 | task | task-6 | returns `invalid` for a ten-slice plan with a message containing `10` and `9` |
| adr-2026-09-29-plan-slice-manifest#D4 | existing | none | Strict `**Dependencies:**` validation for sliced plans is implemented in `validatePlanSlices` (`src/conductor/src/engine/plan-slices.ts`) and covered by `land-spec-plan-slices-dependencies.test.ts`; unchanged here. |
| adr-2026-09-29-plan-slice-manifest#D5 | task | task-9 | a sliced plan with a task in no slice fails with identifier `plan-slices` and not `stacked-delivery` |
| adr-2026-09-29-plan-slice-manifest#D6 | task | task-12, task-14 | returns refusal kind `needs-human` naming story `2` and positions `1` and `2`, leaves the envelope file byte-identical |
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
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | task | task-15 | decides membership through `projectChildOwnership`, rejecting a task recorded in another child with the existing message naming its owning child, and the existing task-cli `--child` tests pass unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | no-change | none | This feature does not change N=1 golden byte identity; the new layers are inert for unsliced and flag-off plans. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | no-change | none | This feature does not change running whole-feature rubrics once at the leaf. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
