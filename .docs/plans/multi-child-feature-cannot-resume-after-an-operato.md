# Implementation Plan: Stacked slice topology from the sealed plan; remove the coverage_binding step

**Date:** 2026-10-23
**Stories:** .docs/stories/multi-child-feature-cannot-resume-after-an-operato.md
**Conflict check:** Clean as of 2026-10-23 (three degrading conflicts accepted; `.docs/conflicts/2026-10-23-multi-child-feature-cannot-resume-after-an-operato.md`)
**Architecture:** `adr-2026-10-23-slice-topology-from-sealed-plan`; `architecture-review-2026-10-23-multi-child-feature-cannot-resume-after-an-operato` (APPROVED WITH CONDITIONS)

## Summary

This plan removes the engine's `coverage_binding` step and its envelope. Every stacked-feature
consumer instead reads slice topology from the sealed plan through one new loader. `reseal`
refuses position changes, and an unresolvable stack cursor halts with its cause and a recovery
command. 20 tasks.

## Technical Approach

- **One loader, `src/conductor/src/engine/slice-topology.ts`.** It lifts the impure composition
  that `runCoverageBinding` performs inline in `step-runners.ts` today: resolve the plan
  (`resolveFeaturePlanPath`) and stories (`resolvePlanStoriesPath`), call the pure `plan-slices.ts`
  functions (`validatePlanSlices`, `deriveStoryOwnership`, `evaluateStackEligibility`,
  `customStepsInPerChildRegion`), and exclude engine-appended remediation ids
  (`isEngineAppendedRemediationTaskId`). It returns a discriminated union: `unsliced`, `sliced`
  (positions, `taskSlices`, titles, story ownership), or `unavailable` with a closed cause
  (`plan-missing`, `plan-invalid`, `positions-changed`, `positions-ref-unreadable`). It also returns
  a separate stack-eligibility verdict, used only where children are created.
- **Positions authority.** When durable child state exists, the loader reads
  `refs/conductor/<slug>/positions` (written by `startChild` in `child-lifecycle.ts`) and compares
  it with the plan's positions. The durable-child-state probe the cursor uses today
  (`hasDurableChildState`) moves where the loader can reach it without an import cycle.
- **Readers re-sourced.** Each reader keeps the field shape it already consumes (positions,
  `taskSlices`, titles, story ownership) and swaps `readCoverageBindingEnvelope` for the loader:
  child cursor, child lifecycle, task progress, task CLI, task-membership hook, acceptance evidence,
  acceptance child input, finish publication, conductor routing, dashboard, and observe. After the
  last reader moves, `coverage-binding-envelope.ts`, `coverage-binding-void.ts`, and
  `coverage-binding-decide-set.ts` are deleted together with `runCoverageBinding` (architecture
  review condition 2).
- **Cursor and halt.** `envelope-missing` becomes `topology-unavailable` carrying the loader cause.
  `runStackPreflight` (`restack/stack-preflight.ts`) writes its own `needs-human` HALT for every
  unresolvable kind (`topology-unavailable`, `git-error`, `detached-head`). It names the cause and
  one recovery command, and emits `loop_halt`, the same way its `divergent` branch already halts
  through `haltRestack`. Reseal recovery text reuses `describeResealRecovery` (`reseal-cli.ts`).
- **Step removal.** The step leaves the step registry (`steps.ts`, `types/steps.ts`), the gate
  predicate (`artifacts.ts`), retries and review defaults (`resolved-config.ts`), model policy
  (`provider-model-policy-defaults.ts`), the model table (`model-table-metadata.ts`,
  `tools/generate-model-table.ts`), rebase refresh and clamp (`gate-invalidation.ts`, `rebase.ts`,
  `gate-code-validity.ts`, `rebase-transition.ts`, `conductor.ts`), and the event union and sinks
  (`types/events.ts`, `event-sinks.ts`).
- **Back-compatibility.** `coverage_binding` joins `RETIRED_TOP_LEVEL_KEYS`, and a parallel
  retired-built-in-step list makes `steps.coverage_binding` warn and be ignored (`config.ts`).
- **Local pattern basis, retired keys.** `RETIRED_TOP_LEVEL_KEYS` in `config.ts` is the precedent.
  - Traits to keep: warn once, delete the key before validation, and never reinterpret it as
    something else.
  - Allowed variation: a parallel map keyed by step name under `steps`.
  - Verified no-fit: the retired `retro` step-name branch in `config.ts`, which fails loudly and
    would halt in-flight features.
- **Sequencing.** Loader first. Then the readers and the reseal guard, which run in parallel. Then
  the preflight halt and resume integration. The step, rebase, event, and config removals run
  independently. The module deletion comes after all readers. Goldens and the test sweeps come
  last.

## Prerequisites

- None. No migration. The positions ref and `describeResealRecovery` already exist.

## Tasks

### Task 1: Add the slice-topology loader over the sealed plan
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/slice-topology.test.ts` with fixture worktrees: an unsliced plan returns `unsliced`; a two-slice plan with stories returns `sliced` with positions `[1,2]`, task membership, titles and story ownership; a plan carrying `rem-1` excludes `rem-1` from membership; a malformed `## Slices` table returns `unavailable` cause `plan-invalid` carrying the slice validation violations; a sliced plan whose stories file is missing returns `plan-invalid` naming the stories path; a missing plan returns `plan-missing` naming the plan path; with durable child state, a positions ref recording `[1,2]` and plan positions `[1,3]` returns `positions-changed` naming both sets; with child state and no readable ref, `positions-ref-unreadable`; with a failing git runner injected at the durable-child-state probe or at the positions-ref read, `git-error`.
2. Verify RED.
3. Implement `slice-topology.ts` by lifting the composition from `runCoverageBinding` (plan path, stories path, `validatePlanSlices`, `deriveStoryOwnership`, `isEngineAppendedRemediationTaskId` exclusion), plus a separate stack-eligibility verdict using `evaluateStackEligibility` and `customStepsInPerChildRegion` over a freshly loaded config. Move the durable-child-state probe so the loader can use it without importing `child-cursor.ts`.
4. Update `plan-slices-consumer-boundary.test.ts` so its production-importer allowlist names `slice-topology.ts` and `land-spec.ts`.
5. Verify GREEN and commit.

**Done when:**
- [test] `slice-topology.test.ts` asserts `loadSliceTopology` returns `sliced` with positions `[1,2]`, per-task positions, titles and story ownership for the two-slice fixture, and `unsliced` for a plan with no `## Slices` section.
- [test] `slice-topology.test.ts` asserts the loader returns `unavailable` with cause `plan-invalid` for a malformed `## Slices` table (carrying the validation violations) and for a missing stories file (naming the stories path), and cause `plan-missing` naming the plan path.
- [test] `slice-topology.test.ts` asserts that with durable child state the loader returns `positions-changed` naming recorded `[1,2]` and plan `[1,3]`, `positions-ref-unreadable` when the positions ref is absent, and `git-error` when a git invocation fails in the durable-child-state probe or the positions-ref read.
- [test] `slice-topology.test.ts` asserts engine-appended remediation task `rem-1` is in no slice's task membership.
- [test] `plan-slices-consumer-boundary.test.ts` asserts the production importers of `plan-slices.ts` are exactly `land-spec.ts` and `slice-topology.ts`.

**Files likely touched:**
- `src/conductor/src/engine/slice-topology.ts` — new loader
- `src/conductor/src/engine/child-cursor.ts` — durable-child-state probe relocation
- `src/conductor/test/engine/slice-topology.test.ts` — new tests
- `src/conductor/test/engine/plan-slices-consumer-boundary.test.ts` — allowlist

**Dependencies:** none

### Task 2: Resolve the stack cursor from the loader
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `child-cursor.test.ts`: a two-child stack with no `.pipeline/coverage-binding.json` resolves `active` child 2; the same stack with `stacked_prs.enabled` turned off after child 1 was created still resolves child 2; a stack whose loader reports `positions-changed` returns `topology-unavailable` carrying that cause; a flat feature returns `no-child`.
2. Verify RED.
3. In `child-cursor.ts`, replace `readCoverageBindingEnvelope`/`positionsFromEnvelope` in `resolveActiveChild`, `resolveSealedLeaf`, `resolveSealedFirst` and `resolveChildBase` with the loader. Replace the `storyOwnership !== undefined` eligibility proxy with the loader's eligibility verdict, consulted only when no durable child state exists. Rename the `envelope-missing` kind to `topology-unavailable` with a `cause` field, and update its exhaustive consumers (`routing/execution-child.ts`, `rewind.ts` refusal message, `kickback-budget-cli.ts`, `conductor.ts` region-activation refusal reasons).
4. Verify GREEN and commit.

**Done when:**
- [test] `child-cursor.test.ts` asserts `resolveActiveChild` returns `active` child 2 for a two-child stack with no `.pipeline/coverage-binding.json` present.
- [test] `child-cursor.test.ts` asserts that with `stacked_prs.enabled` false and child state present, `resolveActiveChild` still returns child 2 and the loader still reports Story 2 owned by position 2.
- [test] `child-cursor.test.ts` asserts a loader `positions-changed` result yields cursor kind `topology-unavailable` with cause `positions-changed`, and a flat feature yields `no-child`.
- `child-cursor.ts` no longer imports `coverage-binding-envelope.ts`, and the TypeScript build passes with every `ActiveChildResolution` switch handling `topology-unavailable`.
- [test] `child-cursor.test.ts` asserts that with no `.pipeline/coverage-binding.json`, `resolveChildBase` for child 2 returns parent child 1's closure tip, `resolveSealedLeaf` returns 2 and `resolveSealedFirst` returns 1, all from the loader.

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts`
- `src/conductor/src/engine/routing/execution-child.ts`
- `src/conductor/src/engine/rewind.ts`
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/child-cursor.test.ts`

**Dependencies:** Task 1

### Task 3: Create and enter children from the loader
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `child-lifecycle.test.ts`: an ineligible sliced plan (flag off in the repository-root config) with no child state yields cursor `no-child` and `startChild` creates nothing; and start child 1 of a sliced, eligible plan with no envelope on disk and asserts the child branch is created and `refs/conductor/<slug>/positions` records the plan's positions; and that region entry for child 2 reads its positions from the plan.
2. Verify RED.
3. In `child-lifecycle.ts`, replace the envelope reads in `startChild` and `enterChildRegion` with the loader (positions from `sliced`, eligibility from the loader's verdict).
4. Verify GREEN and commit.

**Done when:**
- [test] A child-lifecycle test asserts `startChild` on a sliced eligible plan with no `.pipeline/coverage-binding.json` creates `feat/c1/<slug>` and writes `refs/conductor/<slug>/positions` equal to the plan's positions.
- [test] A child-lifecycle test asserts `enterChildRegion` for child 2 resolves its position from the loader's `sliced` result.
- [test] A child-lifecycle test asserts that with no child state, a sliced plan made ineligible by `stacked_prs.enabled: false` in the repository-root config (while the feature worktree's config says true) makes `resolveActiveChild` return `no-child` and `startChild` create no child branch and no positions ref.

**Files likely touched:**
- `src/conductor/src/engine/child-lifecycle.ts`
- `src/conductor/test/engine/child-lifecycle.test.ts`

**Dependencies:** Tasks 1, 2

### Task 4: Read child task scope from the loader (commit hook, task progress, task CLI)
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests: in `task-membership-hook.test.ts`, on a two-child stack with no envelope, a commit on `feat/c1/demo` citing task `2` is accepted and one citing task `5` is refused as owned by child 2, and a commit on the leaf `feat/daemon-demo` is not checked (exit 0, as today); with a stale envelope assigning task `2` to slice 2 on disk, the hook still accepts task `2` on `feat/c1/demo`. In the task-progress and task CLI tests, child scope for child 2 is tasks `4`–`6` with no envelope.
2. Verify RED.
3. Replace envelope reads in `task-membership-check-cli.ts`, `task-progress.ts` (`resolveChildTaskScope`; the slug comes from the caller's feature identity, not `envelope.slug`) and `task-cli.ts` with the loader. Map a loader `unavailable` to the hook's existing unreadable refusal, carrying the cause.
4. Verify GREEN and commit.

**Done when:**
- [test] `task-membership-hook.test.ts` asserts, with no `.pipeline/coverage-binding.json`, that on `feat/c1/demo` the hook's scope is tasks `1`, `2`, `3`, a commit citing task `2` exits 0 and a commit citing task `5` exits non-zero naming child 2 as owner, and a commit on the leaf `feat/daemon-demo` exits 0 unchecked.
- [test] `task-membership-hook.test.ts` asserts a stale envelope assigning task `2` to slice 2 does not change the result: a commit on `feat/c1/demo` citing task `2` is accepted for child 1.
- [test] `resolveChildTaskScope` and the task CLI tests assert child 2's scope is tasks `4`, `5`, `6` with no envelope on disk.
- [test] The task-membership hook, `resolveChildTaskScope` and task CLI tests assert that on a feature with child state whose `## Slices` table is malformed, the hook refuses naming cause `plan-invalid` and `resolveChildTaskScope` and the task CLI report `plan-invalid`, never a flat (unscoped) result.

**Files likely touched:**
- `src/conductor/src/engine/task-membership-check-cli.ts`
- `src/conductor/src/engine/task-progress.ts`
- `src/conductor/src/engine/task-cli.ts`
- `src/conductor/test/engine/task-membership-hook.test.ts`
- `src/conductor/test/engine/task-progress.test.ts`
- `src/conductor/test/engine/task-cli.test.ts`

**Dependencies:** Task 1

### Task 5: Project owned stories from the loader (acceptance input and evidence)
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests: acceptance child input for child 2 of a two-child stack with no envelope receives Story 2 as its only owned story; acceptance evidence grounding (`groundDispositionOnlyEvidence`) and the no-owned-criteria outcome read child ownership from the loader.
2. Verify RED.
3. Replace envelope `storyOwnership` reads in `artifacts.ts` (acceptance evidence grounding and the `acceptance_specs` no-owned-criteria path) and `step-runners.ts` (`acceptanceChildInput`, which today resolves the stories path through `coverage-binding-decide-set.ts`; use `resolvePlanStoriesPath`) with the loader.
4. Verify GREEN and commit.

**Done when:**
- [test] An acceptance child-input test asserts child 2's input lists exactly Story 2 as owned, derived from the sealed plan and stories with no `.pipeline/coverage-binding.json`.
- [test] An acceptance-evidence test asserts `groundDispositionOnlyEvidence` and the no-owned-criteria outcome use the loader's story ownership for the active child.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts`
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/acceptance-child-scope.test.ts`

**Dependencies:** Task 1

### Task 6: Publish and route stacks from the loader
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests: finish publication for a two-child stack with no envelope builds each child's PR from the plan's slice titles and task and story ownership, with positions matching `refs/conductor/<slug>/positions`; conductor routing derives owners from the loader's membership.
2. Verify RED.
3. Replace envelope reads in `finish-publication-production.ts` and in `conductor.ts` routing and taskless routing. Pass the loader's membership to `routeAdmittedRound`, and retype the `Pick<…,'sliceMembership'>` parameters in `routing/owner-derivation.ts` and `routing/round-router.ts` to the loader's membership type.
4. Verify GREEN and commit.

**Done when:**
- [test] `finish-publication-production.test.ts` asserts that with no `.pipeline/coverage-binding.json`, each child PR's title, task list and owned stories come from the sealed plan and the published positions equal `refs/conductor/<slug>/positions`.
- [test] A routing test asserts `routeAdmittedRound` derives the owning child of a task from the loader's task membership.
- [test] A conductor routing test drives an admitted whole-feature finding on a two-child stack with no `.pipeline/coverage-binding.json` through `Conductor` routing admission and asserts the round is routed to the owning child, with no halt naming the task-slice ownership envelope.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/engine/routing/owner-derivation.ts`
- `src/conductor/src/engine/routing/round-router.ts`
- `src/conductor/test/engine/finish-publication-production.test.ts`
- `src/conductor/test/engine/routing/round-router.test.ts`

**Dependencies:** Task 1

### Task 7: Show stacked progress on the dashboard and in observe from the loader
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests: `daemon-dashboard` and `daemon-observe-cli` show a two-child stack with no envelope as stacked with 2 positions and child 2 active.
2. Verify RED.
3. Replace the envelope position-count reads in `daemon-dashboard.ts` and `daemon-observe-cli.ts` with the loader.
4. Verify GREEN and commit.

**Done when:**
- [test] `daemon-dashboard.test.ts` asserts a two-child stack with no `.pipeline/coverage-binding.json` renders as stacked with 2 positions, active child 2 and child 2's tasks `4`, `5`, `6`, not as flat.
- [test] `daemon-observe-cli.test.ts` asserts the same stack reports 2 positions, active child 2 and child 2's tasks `4`, `5`, `6`.
- [test] `daemon-dashboard.test.ts` and `daemon-observe-cli.test.ts` assert that a feature with child state whose `## Slices` table is malformed is shown with cause `plan-invalid`, not as a flat feature.

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts`
- `src/conductor/src/engine/daemon-observe-cli.ts`
- `src/conductor/test/engine/daemon-dashboard.test.ts`
- `src/conductor/test/engine/daemon-observe-cli.test.ts`

**Dependencies:** Task 1

### Task 8: Refuse position-changing reseals and stop voiding on reseal
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `reseal-cli.test.ts` on a two-child stack: resealing a plan that adds slice `3` exits non-zero naming recorded `[1,2]` and proposed `[1,2,3]`, leaves `.pipeline/protected-artifact-seal.json` byte-identical, and leaves an existing `.pipeline/HALT` in place; resealing a plan that removes slice `1` exits non-zero naming `[1,2]` and `[2]` with the seal unchanged; resealing a plan that only moves task `4` between existing slices succeeds; a reseal of a changed ADR writes no `.pipeline/coverage-binding.json` change and no `coverage_binding` state.
2. Verify RED.
3. In `reseal-cli.ts`, before rebaselining a plan path on a feature with durable child state, compute the proposed plan's positions through the loader's plan parsing and compare them with `refs/conductor/<slug>/positions`; refuse on any difference, before any write. Remove the `voidCoverageBindingForDecideChange` call and the decide-set resolution that fed it.
4. Verify GREEN and commit.

**Done when:**
- [test] `reseal-cli.test.ts` asserts a reseal adding slice `3` exits non-zero naming recorded `[1,2]` and proposed `[1,2,3]`, with the seal file byte-identical and the existing HALT still present.
- [test] `reseal-cli.test.ts` asserts a reseal removing slice `1` exits non-zero naming recorded `[1,2]` and proposed `[2]`, with the seal file byte-identical.
- [test] `reseal-cli.test.ts` asserts a reseal that moves task `4` between unchanged slices succeeds and rebaselines the plan.
- `reseal-cli.ts` no longer imports `coverage-binding-void.ts` or `coverage-binding-decide-set.ts`.

**Files likely touched:**
- `src/conductor/src/engine/reseal-cli.ts`
- `src/conductor/test/engine/reseal-cli.test.ts`

**Dependencies:** Task 1

### Task 9: Halt with the cause and a recovery command when the stack cursor cannot resolve
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `restack/stack-preflight-gating.test.ts` for each unresolvable kind: `topology-unavailable` with cause `positions-changed` (HALT names both position sets and an `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command), `plan-missing` (names the plan path and the reseal command), `plan-invalid`, `positions-ref-unreadable` (names a `git update-ref refs/conductor/demo/positions` command re-recording `[1,2]`), `detached-head` (names `git switch feat/daemon-demo`), and `git-error` (names the halt-clear command). Assert each writes `.pipeline/HALT` with class `needs-human` and emits `loop_halt`. Add a daemon re-kick test that the re-kick preflight path writes the same HALT instead of logging `stack preflight: unavailable` and returning.
2. Verify RED.
3. In `runStackPreflight`, replace both silent `unavailable` results (the durable-child-state probe and the cursor branch) with a HALT written through the same halt path its `divergent` branch uses, with text built by a per-cause recovery formatter (reseal text through `describeResealRecovery`). Return `halted`. Make `activateChildRegionStateForResume`'s refusal (`haltChildRegionRefusal`) carry the same cause and recovery text.
4. Verify GREEN and commit.

**Done when:**
- [test] `stack-preflight-gating.test.ts` asserts `runStackPreflight` writes a `needs-human` `.pipeline/HALT` and emits `loop_halt` for each of `positions-changed`, `positions-ref-unreadable`, `plan-missing`, `plan-invalid`, `detached-head` and `git-error` (including git failures injected at the preflight's durable-child-state probe and at the positions-ref read), and returns `halted`, never `unavailable`, so no child region is entered.
- [test] `stack-preflight-gating.test.ts` asserts the HALT text names the cause and its recovery command: for `positions-changed` the recorded `[1,2]` and plan `[1,3]` positions and the `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command; for `plan-missing` the plan path looked for; `git update-ref refs/conductor/demo/positions` re-recording `[1,2]`; `git switch feat/daemon-demo`; and the halt-clear command for `git-error`.
- [test] A daemon dispatch test asserts that for each of the six causes, on a fresh dispatch and on a daemon re-kick, `.pipeline/HALT` contains the run's own cause text and the daemon log has neither a "loop ended without DONE or HALT marker" line nor a `stack preflight: unavailable` line for that dispatch.
- [test] A test asserts that after the printed `git update-ref` recovery is run and the halt cleared, `runStackPreflight` resolves child 2 and returns `clear`.
- [test] A region-activation test asserts `activateChildRegionStateForResume` given a `topology-unavailable` cursor writes a `needs-human` HALT whose text names the cause and the same recovery command the preflight prints.

**Files likely touched:**
- `src/conductor/src/engine/restack/stack-preflight.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/engine/daemon-cli.ts`
- `src/conductor/test/engine/restack/stack-preflight-gating.test.ts`

**Dependencies:** Task 2

### Task 10: Resume a stacked feature after a reseal and after worktree recreation
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing integration tests in `src/conductor/test/integration/stacked-resume-from-plan.test.ts` that drive a real `Conductor` resume on a two-child stack fixture (real git refs, child 1 closed, leaf at `build`). The scenarios: (a) after an operator reseal of a plan prose amendment that keeps positions, the run resolves child 2 and starts `build`, with no HALT and no hand-edited `.pipeline` file; (b) after a reseal of an ADR and story amendment, `events.jsonl` shows `executor_started` then `step_started` `build` with no `halt_record_written` between; (c) after a reseal that only moves task `4` between existing slices, child 2 resumes with membership from the amended plan; (d) after a byte-identical reseal, child 2 resumes at `build` with no pre-region step re-run; (e) with `.pipeline/` removed (worktree recreated), the run resolves child 2 from the committed plan and closure ref and enters its region; (f) after a `positions-changed` halt, restoring positions `[1,2]` and running the printed reseal command lets the next resume enter child 2's region.
2. Verify RED.
3. Make whatever wiring the resume path still needs (region activation through the loader-backed cursor) so the scenarios pass.
4. Verify GREEN and commit.

**Done when:**
- [test] `stacked-resume-from-plan.test.ts` asserts that after a reseal of a positions-preserving plan amendment, the `Conductor` resume resolves child 2 and starts its `build` step with no `.pipeline/HALT` written.
- [test] `stacked-resume-from-plan.test.ts` asserts that after a reseal of an ADR and story amendment, `events.jsonl` records `executor_started` followed by `step_started` for `build` with no `halt_record_written` between them.
- [test] `stacked-resume-from-plan.test.ts` asserts a reseal moving task `4` between unchanged slices resumes child 2 with task membership read from the amended plan, and a byte-identical reseal resumes child 2 at `build` with no step before the child region re-run.
- [test] `stacked-resume-from-plan.test.ts` asserts that with `.pipeline/` removed, the resume resolves child 2 from the committed plan and closure ref and enters its region with no HALT.
- [test] `stacked-resume-from-plan.test.ts` asserts that after a `positions-changed` halt, restoring positions `[1,2]` and running the printed reseal command makes the next resume enter child 2's region.

**Files likely touched:**
- `src/conductor/test/integration/stacked-resume-from-plan.test.ts`
- `src/conductor/src/engine/conductor.ts`

**Dependencies:** Tasks 2, 3, 8, 9

### Task 11: Remove the coverage_binding step from the lifecycle and its model wiring
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Write failing tests: the resolved step registry for a default config has `acceptance_specs` immediately after `plan_review`; `ai-conductor rewind --to coverage_binding` exits non-zero with "Invalid rewind target" listing the valid steps and changes no state.
2. Verify RED.
3. Remove `coverage_binding` from `types/steps.ts`, `steps.ts`, the gate predicate in `artifacts.ts`, `DEFAULT_STEP_RETRIES`/`DEFAULT_STEP_REVIEW` in `resolved-config.ts`, `provider-model-policy-defaults.ts`, `model-table-metadata.ts` and `tools/generate-model-table.ts`. Regenerate the model table. In `test/check_model_table_presence.sh`, drop the `coverage-binding|coverage_binding` row alias and add a `SKILL_NO_ROW_ALLOWLIST` entry for `coverage-binding`, giving its reason as the plan §7a judge policy with no engine step.
4. Verify GREEN and commit.

**Done when:**
- [test] A step-registry test asserts `buildStepRegistry` for the default config places `acceptance_specs` immediately after `plan_review` and contains no `coverage_binding` step.
- [test] A rewind test asserts `rewind --to coverage_binding` exits non-zero with `Invalid rewind target "coverage_binding"` naming `coverage_binding` and listing the valid steps, and leaves conduct state unchanged.
- `test/check_model_table_presence.sh` passes with `skills/coverage-binding/SKILL.md` present, the allowlist entry for `coverage-binding`, and no `coverage_binding` model-table row.

**Files likely touched:**
- `src/conductor/src/types/steps.ts`
- `src/conductor/src/engine/steps.ts`
- `src/conductor/src/engine/artifacts.ts`
- `src/conductor/src/engine/resolved-config.ts`
- `src/conductor/src/engine/provider-model-policy-defaults.ts`
- `src/conductor/src/engine/model-table-metadata.ts`
- `src/conductor/tools/generate-model-table.ts`
- `test/check_model_table_presence.sh`
- `src/conductor/test/engine/steps.test.ts`
- `src/conductor/test/engine/rewind.test.ts`

**Dependencies:** none

### Task 12: Remove coverage_binding from rebase invalidation and continuation
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Write failing tests. First, a two-child stack at the pre-finish `rebase` step, with a base refresh that changes no DECIDE artifact, completes the step with no `coverage_binding` kickback or reopen and continues to the reopened gates without a state-transition error. Second, the same stack with a base change that touches the plan reopens only the delta-authorized gates and never halts with "Expected coverage_binding to match before reopen". Third, a flat feature whose base change touches a cited DECIDE artifact reopens the same gates as before, minus `coverage_binding`.
2. Verify RED.
3. Remove `coverage_binding` from `gate-invalidation.ts` (`feature-coverage-inputs` surface), `rebase.ts` gate order, `gate-code-validity.ts` code-stamp identity, the `conductor.ts` D4 refresh and reopen lists, and `rebase-transition.ts` (`isRebaseCoverageRefresh`, the coverage clamp and its use in `conductor.ts`).
4. Verify GREEN and commit.

**Done when:**
- [test] A restack test asserts a two-child stack's pre-finish `rebase` with a non-DECIDE base refresh records no `coverage_binding` kickback or reopen, completes `step_completed rebase`, and selects the next reopened gate without a conductor error.
- [test] A restack test asserts a base change touching the plan reopens only the delta-authorized gates and raises no "Expected coverage_binding to match before reopen" error.
- [test] A flat rebase test asserts the reopened gate set for a DECIDE-touching base change equals the pre-change set minus `coverage_binding`.

**Files likely touched:**
- `src/conductor/src/engine/gate-invalidation.ts`
- `src/conductor/src/engine/rebase.ts`
- `src/conductor/src/engine/gate-code-validity.ts`
- `src/conductor/src/engine/rebase-transition.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/restack/restack-transition.test.ts`
- `src/conductor/test/engine/gate-invalidation.test.ts`

**Dependencies:** none

### Task 13: Remove the coverage_binding event variants
**Story:** Story 5
**Type:** refactor

**Steps:**
1. Write a failing test: an `events.jsonl` containing `coverage_binding_disabled` and `plan_slices_changed` lines loads through the dashboard, daemon status and the event-history readers without error.
2. Verify RED (or record the existing tolerance if already GREEN, and keep the test).
3. Remove `coverage_binding_judged`, `coverage_binding_amendment_judged`, `coverage_binding_conflict_judged`, `coverage_binding_disabled`, `coverage_binding_invalidated`, `coverage_binding_task_reopened`, `plan_slices_changed` and `story_reowned` from `types/events.ts` and `EVENT_SINKS` in `event-sinks.ts`, keeping the union and sinks in exact correspondence.
4. Verify GREEN and commit.

**Done when:**
- [test] An event-history test asserts an `events.jsonl` with `coverage_binding_disabled` and `plan_slices_changed` lines loads through the dashboard, daemon status and event readers without throwing.
- The `ConductorEvent` union and `EVENT_SINKS` contain none of the eight removed variants, and the existing union-equals-sinks test passes.

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/engine/event-history-legacy-types.test.ts`

**Dependencies:** none

### Task 14: Keep retired coverage_binding configuration loading
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `config.test.ts`. A legacy config with a top-level `coverage_binding:` block and `steps.coverage_binding.llm_provider` loads, warns once naming each key as retired and ignored, and resolves no `coverage_binding` step. An unrelated unknown top-level key `not_a_real_key` still fails naming it. A custom step `my_step` with no `after` still fails naming `my_step` and the missing `after`.
2. Verify RED.
3. Add `coverage_binding` to `RETIRED_TOP_LEVEL_KEYS`. Add a retired-built-in-step map consulted before custom-step validation under `steps`, which warns and deletes `steps.coverage_binding`. Follow the `RETIRED_TOP_LEVEL_KEYS` traits: warn once, delete before validation, never reinterpret. Remove the `coverage_binding` config schema and validation and its types in `types/config.ts`. Remove the keys from `templates/project-config.yml.template`.
4. Verify GREEN and commit.

**Done when:**
- [test] `config.test.ts` asserts `loadConfig` on the legacy config succeeds, emits one warning naming `coverage_binding` and one naming `steps.coverage_binding` as retired and ignored, and the resolved registry has no `coverage_binding` step.
- [test] `config.test.ts` asserts a config with unknown top-level key `not_a_real_key` still fails naming `not_a_real_key`.
- [test] `config.test.ts` asserts a custom step `my_step` with no `after` still fails naming `my_step` and the missing `after`.
- [test] A rewind test with the legacy config loaded asserts `rewind --to coverage_binding` exits non-zero with `Invalid rewind target "coverage_binding"` naming `coverage_binding` and listing the valid steps, and leaves conduct state unchanged.

**Files likely touched:**
- `src/conductor/src/engine/config.ts`
- `src/conductor/src/types/config.ts`
- `templates/project-config.yml.template`
- `src/conductor/test/engine/config.test.ts`
- `src/conductor/test/engine/rewind.test.ts`

**Dependencies:** Task 11

### Task 15: Ignore leftover coverage_binding state on resume
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests: a flat feature at `build` whose changed ADR is resealed continues at `build` on the next dispatch with no `coverage_binding` run and no HALT; and a flat feature and a two-child stack each carry the leftover state: `conduct-state.json` with `coverage_binding: stale`, `.pipeline/gates/coverage_binding.json`, `.pipeline/coverage-binding.json` and `.pipeline/coverage-binding-code-stamp.json`. A resume must select its next step from the current lifecycle, never select, reopen or wait on `coverage_binding`, and not halt because of those files.
2. Verify RED.
3. Make the selector, resume and verdict-listing paths ignore a `coverage_binding` state key and verdict file the registry does not declare, without deleting them.
4. Verify GREEN and commit.

**Done when:**
- [test] A resume test asserts a flat feature with leftover `coverage_binding: stale` state and verdict proceeds to its next lifecycle step without re-running or reopening `coverage_binding`.
- [test] A resume test asserts a two-child stack with all four leftover files resumes child 2's region without a HALT caused by those files.
- [test] A resume test asserts a flat feature at `build` whose changed ADR is resealed continues at `build` on the next dispatch with no `coverage_binding` step run and no `.pipeline/HALT` written.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/engine/gate-verdicts.ts`
- `src/conductor/test/engine/leftover-coverage-binding-state.test.ts`

**Dependencies:** Task 11

### Task 16: Delete the coverage_binding runner and its envelope, void and decide-set modules
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Delete `runCoverageBinding` and `verifyStackPositionImmutability` from `step-runners.ts`, and the step's dispatch wiring.
2. Delete `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts`, with their dedicated tests (`coverage-binding-*.test.ts`) and the `test/fixtures/coverage-binding-conflicts/` fixtures. Re-home any surviving assertion about slice membership or position immutability into `slice-topology.test.ts` or `reseal-cli.test.ts` (Tasks 1 and 8).
3. Add `src/conductor/test/engine/slice-topology-consumer-boundary.test.ts`: pin the exact production importer set of `slice-topology.ts` (the same pattern as `plan-slices-consumer-boundary.test.ts`), and drive a malformed-`## Slices` two-child fixture through each importer's entry point.
4. Run typecheck: no module imports a deleted file.
5. Commit.

**Done when:**
- `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted.
- The TypeScript build passes with no import of a deleted module, and `skills/coverage-binding/SKILL.md` is still present.
- [test] `slice-topology-consumer-boundary.test.ts` asserts the production importers of `slice-topology.ts` are exactly `child-cursor.ts`, `child-lifecycle.ts`, `task-progress.ts`, `task-cli.ts`, `task-membership-check-cli.ts`, `artifacts.ts`, `step-runners.ts`, `finish-publication-production.ts`, `conductor.ts`, `daemon-dashboard.ts`, `daemon-observe-cli.ts`, `reseal-cli.ts`, `routing/owner-derivation.ts` and `routing/round-router.ts`.
- [test] `slice-topology-consumer-boundary.test.ts` feeds a two-child fixture with a malformed `## Slices` table through each listed importer's entry point and asserts every one reports or refuses with cause `plan-invalid` and none returns a flat (unsliced) result.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/src/engine/coverage-binding-envelope.ts`
- `src/conductor/src/engine/coverage-binding-void.ts`
- `src/conductor/src/engine/coverage-binding-decide-set.ts`
- `src/conductor/test/engine/coverage-binding-decide-set.test.ts`
- `src/conductor/test/engine/coverage-binding-envelope.test.ts`
- `src/conductor/test/engine/coverage-binding-position-guard.test.ts`
- `src/conductor/test/engine/coverage-binding-runner.test.ts`
- `src/conductor/test/engine/coverage-binding-slice-layer.test.ts`
- `src/conductor/test/engine/coverage-binding-slice-membership.test.ts`
- `src/conductor/test/engine/coverage-binding-stacked-delivery.test.ts`
- `src/conductor/test/engine/coverage-binding-void.test.ts`
- `src/conductor/test/engine/slice-topology-consumer-boundary.test.ts`

**Dependencies:** Tasks 2, 3, 4, 5, 6, 7, 8, 11, 12, 13

### Task 17: Regenerate the N=1 golden fixtures without the step
**Story:** Story 6
**Type:** refactor

**Steps:**
1. Regenerate the `test/fixtures/n1-golden/` goldens. Delete the two cells `flag-on-ineligible-coverage-binding.golden` and `flag-on-single-slice-coverage-binding.golden`.
2. Diff each regenerated golden against its pre-change version and confirm every changed line is a removed `coverage_binding` step line.
3. Assert in `n1-golden-state.test.ts` that a flat run writes no `refs/conductor/` ref, no `.pipeline/children/` directory, and no slice event.
4. Commit.

**Done when:**
- [test] The N=1 golden suite (`n1-golden-state.test.ts`, `n1-golden-renderings.test.ts`, `n1-golden-routing-guard.test.ts`) passes against the regenerated goldens.
- Every retained golden's diff against its pre-change version consists only of removed `coverage_binding` step lines, and the only deleted goldens are `flag-on-ineligible-coverage-binding.golden` and `flag-on-single-slice-coverage-binding.golden`.
- [test] `n1-golden-state.test.ts` asserts a flat run writes no `refs/conductor/` ref, no `.pipeline/children/` directory and no slice event.

**Files likely touched:**
- `src/conductor/test/fixtures/n1-golden/`
- `src/conductor/test/engine/n1-golden-state.test.ts`

**Dependencies:** Tasks 11, 12, 13, 16

### Task 18: Update restack and routing tests to the plan-derived topology
**Story:** Story 6
**Type:** refactor

**Steps:**
1. In `src/conductor/test/engine/restack/` and `src/conductor/test/engine/routing/`, replace fixtures that seed `.pipeline/coverage-binding.json` with fixtures whose committed plan declares the slices. Remove `coverage_binding` from step lists and expected events.
2. Run the affected test files.
3. Commit.

**Done when:**
- No test under `src/conductor/test/engine/restack/` or `src/conductor/test/engine/routing/` writes `.pipeline/coverage-binding.json` or names a `coverage_binding` step or event.
- [test] The test files under `src/conductor/test/engine/restack/` and `src/conductor/test/engine/routing/` pass.

**Files likely touched:**
- `src/conductor/test/engine/restack/`
- `src/conductor/test/engine/routing/`

**Dependencies:** Task 16

### Task 19: Update the remaining engine, acceptance and integration tests
**Story:** Story 6
**Type:** refactor

**Steps:**
1. In the remaining test files that reference the step (`src/conductor/test/engine/`, `src/conductor/test/acceptance/`, `src/conductor/test/integration/`, `src/conductor/test/ui/`, and `src/conductor/test/engine/config-consumer-registry.ts`), replace envelope fixtures with plan-declared slices, and remove `coverage_binding` from step lists, expected events and config fixtures.
2. Run the affected test files.
3. Commit.

**Done when:**
- No test outside Tasks 1–18's files writes `.pipeline/coverage-binding.json` or expects a `coverage_binding` step, verdict or event, apart from the leftover-state, legacy-config and legacy-event tests of Tasks 13–15.
- [test] The affected files under `src/conductor/test/engine/`, `src/conductor/test/acceptance/`, `src/conductor/test/integration/` and `src/conductor/test/ui/` pass.
- [test] `config-consumer-registry.ts` names `slice-topology.ts`, not the `coverage_binding` runner, as the reader of `stacked_prs.enabled` and `stacked_prs.max_slices`, and the config-consumer registry test passes.

**Files likely touched:**
- `src/conductor/test/engine/`
- `src/conductor/test/acceptance/`
- `src/conductor/test/integration/`
- `src/conductor/test/ui/`

**Dependencies:** Task 16

### Task 20: Point plan authoring's coverage judgement at the retained skill only
**Story:** Story 6
**Type:** refactor

**Steps:**
1. In `skills/plan/SKILL.md` §7a, replace "the engine's `coverage_binding` step is a no-op and does not re-judge before BUILD" with a statement that no engine step re-judges coverage before BUILD. Keep the instruction to apply `skills/coverage-binding/SKILL.md` as the judgement policy unchanged.
2. Run `test/test_harness_integrity.sh`'s skill checks.
3. Commit.

**Done when:**
- `skills/plan/SKILL.md` §7a names no `coverage_binding` engine step and still instructs the subagent to apply `skills/coverage-binding/SKILL.md`.
- [test] The harness integrity skill and model-table checks pass with `skills/coverage-binding/SKILL.md` retained.

**Files likely touched:**
- `skills/plan/SKILL.md`

**Dependencies:** Task 11

## Task Dependency Graph

```
Task 1 ──┬─> Task 2 ──┬─> Task 3 ──┐
         │            └─> Task 9 ──┼─> Task 10
         ├─> Task 8 ───────────────┘
         ├─> Task 4
         ├─> Task 5
         ├─> Task 6
         └─> Task 7
Task 11 ─┬─> Task 14
         ├─> Task 15
         └─> Task 20
Task 12, Task 13 (independent)
Tasks 2–8, 11–13 ──> Task 16 ──┬─> Task 17
                               ├─> Task 18
                               └─> Task 19
```

## Integration Points

- After Task 2: the stack cursor resolves without any envelope on disk.
- After Task 9: every unresolvable-cursor dispatch ends with the run's own HALT.
- After Task 10: both #3365 triggers (reseal, worktree recreation) resume end to end through the `Conductor` resume entry point (architecture review condition 4).
- After Task 16: no production module reads or writes the envelope.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the two-child stack and an operator amendment to its plan's prose that leaves the `## Slices` positions unchanged, when the operator runs `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` and the daemon dispatches the feature, then the run resolves child 2 as the active child and runs its `build` step, with no `.pipeline` file edited by hand and no HALT written. | 10 | "`stacked-resume-from-plan.test.ts` asserts that after a reseal of a positions-preserving plan amendment, the `Conductor` resume resolves child 2 and starts its `build` step with no `.pipeline/HALT` written." | diff-local |
| Story 1 happy: Given the two-child stack and an operator amendment to its ADR and story that the reseal rebaselines, when the next dispatch runs, then child 2's region resumes at `build` and `events.jsonl` records `executor_started` followed by `step_started` for `build`, with no `halt_record_written` between them. | 10 | "`stacked-resume-from-plan.test.ts` asserts that after a reseal of an ADR and story amendment, `events.jsonl` records `executor_started` followed by `step_started` for `build` with no `halt_record_written` between them." | diff-local |
| Story 1 negative: Given the two-child stack and a plan amendment that moves task `4` from slice 2 to slice 1 without changing the positions, when the operator reseals the plan, then the reseal succeeds and the next dispatch resolves child 2 with task membership read from the amended plan. | 8, 10 | "`reseal-cli.test.ts` asserts a reseal that moves task `4` between unchanged slices succeeds and rebaselines the plan." | diff-local |
| Story 1 negative: Given the two-child stack and a plan amendment that adds a slice at position `3`, when the operator runs reseal on the plan, then reseal exits non-zero, names the recorded positions `[1,2]` and the proposed positions `[1,2,3]`, leaves the protected-artifact seal unchanged, and leaves any existing HALT in place. | 8 | "`reseal-cli.test.ts` asserts a reseal adding slice `3` exits non-zero naming recorded `[1,2]` and proposed `[1,2,3]`, with the seal file byte-identical and the existing HALT still present." | diff-local |
| Story 1 negative: Given the two-child stack and a plan amendment that removes slice `1`, when the operator runs reseal on the plan, then reseal exits non-zero naming the recorded positions `[1,2]` and the proposed positions `[2]`, and the seal is unchanged. | 8 | "`reseal-cli.test.ts` asserts a reseal removing slice `1` exits non-zero naming recorded `[1,2]` and proposed `[2]`, with the seal file byte-identical." | diff-local |
| Story 1 negative: Given the two-child stack and a byte-identical reseal of its plan, when the next dispatch runs, then child 2 resumes at `build` and no step before the child region is re-run. | 10 | "`stacked-resume-from-plan.test.ts` asserts a reseal moving task `4` between unchanged slices resumes child 2 with task membership read from the amended plan, and a byte-identical reseal resumes child 2 at `build` with no step before the child region re-run." | diff-local |
| Story 2 happy: Given the two-child stack whose worktree was recreated from `feat/daemon-demo` with an empty `.pipeline/` directory, when the daemon dispatches the feature, then the run resolves child 2 as the active child from the committed plan and the closure ref, and enters child 2's region with no HALT. | 10 | "`stacked-resume-from-plan.test.ts` asserts that with `.pipeline/` removed, the resume resolves child 2 from the committed plan and closure ref and enters its region with no HALT." | diff-local |
| Story 2 negative: Given the two-child stack whose recreated worktree has a plan in which a commit after the positions were recorded moved slice positions to `[1,3]`, when the daemon dispatches the feature, then the run halts `needs-human` naming the cause `positions-changed`, the recorded positions `[1,2]` and the plan positions `[1,3]`, and enters no child region. | 9 | "`stack-preflight-gating.test.ts` asserts the HALT text names the cause and its recovery command: for `positions-changed` the recorded `[1,2]` and plan `[1,3]` positions and the `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command; for `plan-missing` the plan path looked for; `git update-ref refs/conductor/demo/positions` re-recording `[1,2]`; `git switch feat/daemon-demo`; and the halt-clear command for `git-error`." | diff-local |
| Story 2 negative: Given the two-child stack whose recreated worktree has no readable plan file at the feature's plan path, when the daemon dispatches the feature, then the run halts `needs-human` naming the cause `plan-missing` and the plan path it looked for. | 9 | "`stack-preflight-gating.test.ts` asserts the HALT text names the cause and its recovery command: for `positions-changed` the recorded `[1,2]` and plan `[1,3]` positions and the `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command; for `plan-missing` the plan path looked for; `git update-ref refs/conductor/demo/positions` re-recording `[1,2]`; `git switch feat/daemon-demo`; and the halt-clear command for `git-error`." | diff-local |
| Story 3 happy: Given the two-child stack, when a commit on child 1's branch `feat/c1/demo` cites task `2`, then the task-membership commit hook accepts it as owned by child 1, a commit there citing task `5` is refused as owned by child 2, and a commit on the leaf `feat/daemon-demo` is not checked, exactly as before this change. | 4 | "`task-membership-hook.test.ts` asserts, with no `.pipeline/coverage-binding.json`, that on `feat/c1/demo` the hook's scope is tasks `1`, `2`, `3`, a commit citing task `2` exits 0 and a commit citing task `5` exits non-zero naming child 2 as owner, and a commit on the leaf `feat/daemon-demo` exits 0 unchecked." | diff-local |
| Story 3 happy: Given the two-child stack with child 2 active, when the acceptance step builds child 2's input, then it receives Story 2 as the only owned story, derived from the sealed plan and stories. | 5 | "An acceptance child-input test asserts child 2's input lists exactly Story 2 as owned, derived from the sealed plan and stories with no `.pipeline/coverage-binding.json`." | diff-local |
| Story 3 happy: Given the two-child stack at its finish, when stack publication runs, then each child's PR is built from slice titles and task and story ownership read from the sealed plan, matching the positions recorded in `refs/conductor/demo/positions`. | 6 | "`finish-publication-production.test.ts` asserts that with no `.pipeline/coverage-binding.json`, each child PR's title, task list and owned stories come from the sealed plan and the published positions equal `refs/conductor/<slug>/positions`." | diff-local |
| Story 3 happy: Given the two-child stack with `stacked_prs.enabled` turned off after child 1 was created, when the cursor resolves, then it still resolves child 2 and still reports Story 2 as owned by child 2. | 2 | "`child-cursor.test.ts` asserts that with `stacked_prs.enabled` false and child state present, `resolveActiveChild` still returns child 2 and the loader still reports Story 2 owned by position 2." | diff-local |
| Story 3 negative: Given the two-child stack with `.pipeline/coverage-binding.json` deleted, when the task-membership commit hook checks a commit on `feat/c1/demo` and the task CLI, the dashboard, and daemon observe read child 2's scope, then the hook uses child 1's tasks `1`–`3` and the others report child 2's tasks `4`–`6`, all from the plan, instead of treating the feature as flat. | 4, 7 | "`resolveChildTaskScope` and the task CLI tests assert child 2's scope is tasks `4`, `5`, `6` with no envelope on disk." | diff-local |
| Story 3 negative: Given the two-child stack whose `.pipeline/coverage-binding.json` holds a stale envelope assigning task `2` to slice 2, when the commit hook checks a commit on `feat/c1/demo` citing task `2`, then it uses the sealed plan and accepts it for child 1. | 4 | "`task-membership-hook.test.ts` asserts a stale envelope assigning task `2` to slice 2 does not change the result: a commit on `feat/c1/demo` citing task `2` is accepted for child 1." | diff-local |
| Story 3 negative: Given a sliced plan whose stories file is missing, when the topology is read on a feature with child state, then the read reports cause `plan-invalid` naming the missing stories path rather than reporting no story ownership. | 1 | "`slice-topology.test.ts` asserts the loader returns `unavailable` with cause `plan-invalid` for a malformed `## Slices` table (carrying the validation violations) and for a missing stories file (naming the stories path), and cause `plan-missing` naming the plan path." | diff-local |
| Story 3 negative: Given the two-child stack, when the plan's `## Slices` table is malformed after a reseal, then the topology read reports cause `plan-invalid` with the slice validation violations, and no consumer treats the feature as flat. | 1, 16 | "`slice-topology-consumer-boundary.test.ts` feeds a two-child fixture with a malformed `## Slices` table through each listed importer's entry point and asserts every one reports or refuses with cause `plan-invalid` and none returns a flat (unsliced) result." | diff-local |
| Story 3 negative: Given a stacked feature whose plan carries engine-appended remediation task `rem-1`, when the topology is read, then `rem-1` is in no slice's task membership, as before this change. | 1 | "`slice-topology.test.ts` asserts engine-appended remediation task `rem-1` is in no slice's task membership." | diff-local |
| Story 4 happy: Given the two-child stack whose plan positions are `[1,3]` while the positions ref records `[1,2]`, when the daemon dispatches the feature, then `.pipeline/HALT` is written by the run with class `needs-human`, names cause `positions-changed` and both position sets, gives an `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command to run after restoring the positions, and `events.jsonl` records `loop_halt`. | 9 | "`stack-preflight-gating.test.ts` asserts the HALT text names the cause and its recovery command: for `positions-changed` the recorded `[1,2]` and plan `[1,3]` positions and the `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command; for `plan-missing` the plan path looked for; `git update-ref refs/conductor/demo/positions` re-recording `[1,2]`; `git switch feat/daemon-demo`; and the halt-clear command for `git-error`." | diff-local |
| Story 4 happy: Given the two-child stack whose `refs/conductor/demo/positions` ref was deleted, when the daemon dispatches the feature, then the run writes a `needs-human` HALT naming cause `positions-ref-unreadable` and a `git update-ref refs/conductor/demo/positions` command that re-records the plan's positions `[1,2]`. | 9 | "`stack-preflight-gating.test.ts` asserts the HALT text names the cause and its recovery command: for `positions-changed` the recorded `[1,2]` and plan `[1,3]` positions and the `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command; for `plan-missing` the plan path looked for; `git update-ref refs/conductor/demo/positions` re-recording `[1,2]`; `git switch feat/daemon-demo`; and the halt-clear command for `git-error`." | diff-local |
| Story 4 happy: Given the two-child stack whose worktree is on a detached HEAD, when the daemon dispatches the feature, then the run writes a `needs-human` HALT naming cause `detached-head` and a `git switch feat/daemon-demo` command. | 9 | "`stack-preflight-gating.test.ts` asserts the HALT text names the cause and its recovery command: for `positions-changed` the recorded `[1,2]` and plan `[1,3]` positions and the `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command; for `plan-missing` the plan path looked for; `git update-ref refs/conductor/demo/positions` re-recording `[1,2]`; `git switch feat/daemon-demo`; and the halt-clear command for `git-error`." | diff-local |
| Story 4 happy: Given the two-child stack where a git invocation in cursor resolution fails, when the daemon dispatches the feature, then the run writes a `needs-human` HALT naming cause `git-error` and the command that clears the halt so the daemon re-dispatches. | 9 | "`stack-preflight-gating.test.ts` asserts the HALT text names the cause and its recovery command: for `positions-changed` the recorded `[1,2]` and plan `[1,3]` positions and the `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command; for `plan-missing` the plan path looked for; `git update-ref refs/conductor/demo/positions` re-recording `[1,2]`; `git switch feat/daemon-demo`; and the halt-clear command for `git-error`." | diff-local |
| Story 4 negative: Given any unresolvable-cursor dispatch above, when the run ends, then the daemon log does not contain "loop ended without DONE or HALT marker" for that dispatch and `.pipeline/HALT` contains the run's own cause text. | 9 | "A daemon dispatch test asserts that for each of the six causes, on a fresh dispatch and on a daemon re-kick, `.pipeline/HALT` contains the run's own cause text and the daemon log has neither a "loop ended without DONE or HALT marker" line nor a `stack preflight: unavailable` line for that dispatch." | diff-local |
| Story 4 negative: Given the two-child stack halted with cause `positions-changed`, when the operator restores the plan's positions to `[1,2]` and runs the printed reseal command, then the next dispatch resolves child 2 and enters its region. | 10 | "`stacked-resume-from-plan.test.ts` asserts that after a `positions-changed` halt, restoring positions `[1,2]` and running the printed reseal command makes the next resume enter child 2's region." | diff-local |
| Story 4 negative: Given the two-child stack halted with cause `positions-ref-unreadable`, when the operator runs the printed `git update-ref` command and clears the halt, then the next dispatch resolves child 2. | 9 | "A test asserts that after the printed `git update-ref` recovery is run and the halt cleared, `runStackPreflight` resolves child 2 and returns `clear`." | diff-local |
| Story 4 negative: Given a daemon re-kick of the two-child stack with an unresolvable cursor, when the re-kick's stack preflight runs, then it writes the same HALT naming the cause instead of logging `stack preflight: unavailable` and returning silently. | 9 | "A daemon dispatch test asserts that for each of the six causes, on a fresh dispatch and on a daemon re-kick, `.pipeline/HALT` contains the run's own cause text and the daemon log has neither a "loop ended without DONE or HALT marker" line nor a `stack preflight: unavailable` line for that dispatch." | diff-local |
| Story 5 happy: Given the legacy config, when the engine loads it, then loading succeeds, one warning names each of `coverage_binding` and `steps.coverage_binding` as retired and ignored, and the resolved step list contains no `coverage_binding` step. | 14 | "`config.test.ts` asserts `loadConfig` on the legacy config succeeds, emits one warning naming `coverage_binding` and one naming `steps.coverage_binding` as retired and ignored, and the resolved registry has no `coverage_binding` step." | diff-local |
| Story 5 happy: Given a feature worktree with leftover state, when the daemon dispatches the feature, then the run selects its next step from the current lifecycle, never selects or waits on `coverage_binding`, and does not halt because of the leftover files. | 15 | "A resume test asserts a flat feature with leftover `coverage_binding: stale` state and verdict proceeds to its next lifecycle step without re-running or reopening `coverage_binding`." | diff-local |
| Story 5 happy: Given a feature's `events.jsonl` containing `coverage_binding_disabled` and `plan_slices_changed` lines from before this change, when the dashboard, daemon status, and event readers load it, then they load without error. | 13 | "An event-history test asserts an `events.jsonl` with `coverage_binding_disabled` and `plan_slices_changed` lines loads through the dashboard, daemon status and event readers without throwing." | diff-local |
| Story 5 negative: Given a config with an unrelated unknown top-level key `not_a_real_key`, when the engine loads it, then loading still fails naming `not_a_real_key`. | 14 | "`config.test.ts` asserts a config with unknown top-level key `not_a_real_key` still fails naming `not_a_real_key`." | diff-local |
| Story 5 negative: Given a config declaring a custom step `my_step` with no `after`, when the engine loads it, then loading still fails naming `my_step` and the missing `after`. | 14 | "`config.test.ts` asserts a custom step `my_step` with no `after` still fails naming `my_step` and the missing `after`." | diff-local |
| Story 5 negative: Given the legacy config, when an operator runs `ai-conductor rewind --to coverage_binding`, then the command exits non-zero naming `coverage_binding` as not a step of the lifecycle, and no state is changed. | 14 | "A rewind test with the legacy config loaded asserts `rewind --to coverage_binding` exits non-zero with `Invalid rewind target "coverage_binding"` naming `coverage_binding` and listing the valid steps, and leaves conduct state unchanged." | diff-local |
| Story 6 happy: Given a flat feature with an accepted plan, when the conductor runs from `plan_review` into BUILD, then `acceptance_specs` is the step after `plan_review`, and no ref, child state, or slice event is written. | 11, 17 | "A step-registry test asserts `buildStepRegistry` for the default config places `acceptance_specs` immediately after `plan_review` and contains no `coverage_binding` step." | diff-local |
| Story 6 happy: Given the N=1 golden fixture suite, when it runs, then every retained golden differs from its pre-change version only by the removed `coverage_binding` step lines, and the only goldens removed are the two `coverage_binding` cells `flag-on-ineligible-coverage-binding.golden` and `flag-on-single-slice-coverage-binding.golden`. | 17 | "Every retained golden's diff against its pre-change version consists only of removed `coverage_binding` step lines, and the only deleted goldens are `flag-on-ineligible-coverage-binding.golden` and `flag-on-single-slice-coverage-binding.golden`." | diff-local |
| Story 6 happy: Given the two-child stack at the pre-finish `rebase` step with a base refresh that changes no DECIDE artifact, when the rebase restacks children 1 and 2, then the rebase step completes, no `coverage_binding` kickback or reopen is recorded, and the loop continues to the gates the restack reopened without a conductor state-transition error. | 12 | "A restack test asserts a two-child stack's pre-finish `rebase` with a non-DECIDE base refresh records no `coverage_binding` kickback or reopen, completes `step_completed rebase`, and selects the next reopened gate without a conductor error." | diff-local |
| Story 6 happy: Given a flat feature at the pre-finish `rebase` step whose base change touches a DECIDE artifact the feature cites, when the rebase completes, then the gates it reopens are the same as before this change apart from `coverage_binding`. | 12 | "A flat rebase test asserts the reopened gate set for a DECIDE-touching base change equals the pre-change set minus `coverage_binding`." | diff-local |
| Story 6 happy: Given a flat feature in BUILD at `build` whose ADR the operator amends and reseals, when the next dispatch runs, then BUILD continues at `build` with no `coverage_binding` step run and no HALT written. | 15 | "A resume test asserts a flat feature at `build` whose changed ADR is resealed continues at `build` on the next dispatch with no `coverage_binding` step run and no `.pipeline/HALT` written." | diff-local |
| Story 6 negative: Given a flat feature with leftover state recording `coverage_binding: stale`, when the conductor resumes, then it does not re-run or reopen `coverage_binding`, and proceeds to its next lifecycle step. | 15 | "A resume test asserts a flat feature with leftover `coverage_binding: stale` state and verdict proceeds to its next lifecycle step without re-running or reopening `coverage_binding`." | diff-local |
| Story 6 negative: Given the two-child stack at the pre-finish `rebase` step whose base change touches the feature's plan, when the rebase completes, then the loop reopens the gates the delta authorizes and does not halt with "Expected coverage_binding to match before reopen". | 12 | "A restack test asserts a base change touching the plan reopens only the delta-authorized gates and raises no "Expected coverage_binding to match before reopen" error." | diff-local |
| Story 6 negative: Given the harness integrity check, when it runs, then the model-table presence check passes with `skills/coverage-binding/SKILL.md` present and no engine-step model-table row for `coverage_binding`. | 11 | "`test/check_model_table_presence.sh` passes with `skills/coverage-binding/SKILL.md` present, the allowlist entry for `coverage-binding`, and no `coverage_binding` model-table row." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-23-slice-topology-from-sealed-plan#D1 | task | task-11, task-12, task-13, task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-10-23-slice-topology-from-sealed-plan#D2 | task | task-1, task-2, task-3, task-16 | `slice-topology.test.ts` asserts `loadSliceTopology` returns `sliced` with positions `[1,2]`, per-task positions, titles and story ownership for the two-slice fixture, and `unsliced` for a plan with no `## Slices` section. |
| adr-2026-10-23-slice-topology-from-sealed-plan#D3 | task | task-1, task-8 | `reseal-cli.test.ts` asserts a reseal adding slice `3` exits non-zero naming recorded `[1,2]` and proposed `[1,2,3]`, with the seal file byte-identical and the existing HALT still present. |
| adr-2026-10-23-slice-topology-from-sealed-plan#D4 | task | task-2 | `child-cursor.test.ts` asserts a loader `positions-changed` result yields cursor kind `topology-unavailable` with cause `positions-changed`, and a flat feature yields `no-child`. |
| adr-2026-10-23-slice-topology-from-sealed-plan#D5 | task | task-9 | `stack-preflight-gating.test.ts` asserts `runStackPreflight` writes a `needs-human` `.pipeline/HALT` and emits `loop_halt` for each of `positions-changed`, `positions-ref-unreadable`, `plan-missing`, `plan-invalid`, `detached-head` and `git-error` (including git failures injected at the preflight's durable-child-state probe and at the positions-ref read), and returns `halted`, never `unavailable`, so no child region is entered. |
| adr-2026-10-23-slice-topology-from-sealed-plan#D6 | task | task-13, task-14, task-15 | `config.test.ts` asserts `loadConfig` on the legacy config succeeds, emits one warning naming `coverage_binding` and one naming `steps.coverage_binding` as retired and ignored, and the resolved registry has no `coverage_binding` step. |
| adr-2026-10-23-slice-topology-from-sealed-plan#D7 | task | task-17 | Every retained golden's diff against its pre-change version consists only of removed `coverage_binding` step lines, and the only deleted goldens are `flag-on-ineligible-coverage-binding.golden` and `flag-on-single-slice-coverage-binding.golden`. |
| adr-2026-08-31-coverage-binding-judge-step#D1 | existing | none | The criterion-claim contract is enforced at land by `checkCriterionCoverage` in `src/conductor/src/engine/engineer/coherence-validator.ts`; this feature does not change it (D1 stands per the 2026-10-23 amendment). |
| adr-2026-08-31-coverage-binding-judge-step#D2 | existing | none | `checkCriterionCoverage` in `engineer/coherence-validator.ts` still draws the quote from the cited task's `Done when` block at land; unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D3 | existing | none | `runCoherenceGate` in `engineer/coherence-validator.ts` still engages the criterion contract at tier S; unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D4 | task | task-11, task-16 | A step-registry test asserts `buildStepRegistry` for the default config places `acceptance_specs` immediately after `plan_review` and contains no `coverage_binding` step. |
| adr-2026-08-31-coverage-binding-judge-step#D5 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D6 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D7 | task | task-14 | `config.test.ts` asserts `loadConfig` on the legacy config succeeds, emits one warning naming `coverage_binding` and one naming `steps.coverage_binding` as retired and ignored, and the resolved registry has no `coverage_binding` step. |
| adr-2026-08-31-coverage-binding-judge-step#D8 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D9 | task | task-13 | The `ConductorEvent` union and `EVENT_SINKS` contain none of the eight removed variants, and the existing union-equals-sinks test passes. |
| adr-2026-08-31-coverage-binding-judge-step#D10 | existing | none | The shared criterion-row parser in `coherence-parse.ts` still accepts the seventh correction cell at land; unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D11 | existing | none | `runCoherenceGate` in `engineer/coherence-validator.ts` still resolves `architecture:<adr-stem>#D<n>` correction references against `parseAdrDecisions`; unchanged. |
| adr-2026-08-31-coverage-binding-judge-step#D12 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D13 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D14 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D15 | task | task-14 | `config.test.ts` asserts `loadConfig` on the legacy config succeeds, emits one warning naming `coverage_binding` and one naming `steps.coverage_binding` as retired and ignored, and the resolved registry has no `coverage_binding` step. |
| adr-2026-08-31-coverage-binding-judge-step#D16 | task | task-8 | `reseal-cli.ts` no longer imports `coverage-binding-void.ts` or `coverage-binding-decide-set.ts`. |
| adr-2026-08-31-coverage-binding-judge-step#D17 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D18 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D19 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D20 | task | task-13 | The `ConductorEvent` union and `EVENT_SINKS` contain none of the eight removed variants, and the existing union-equals-sinks test passes. |
| adr-2026-08-31-coverage-binding-judge-step#D21 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D22 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D23 | task | task-16 | `step-runners.ts` contains no `runCoverageBinding` or `verifyStackPositionImmutability`, and `coverage-binding-envelope.ts`, `coverage-binding-void.ts` and `coverage-binding-decide-set.ts` are deleted. |
| adr-2026-08-31-coverage-binding-judge-step#D24 | task | task-13 | The `ConductorEvent` union and `EVENT_SINKS` contain none of the eight removed variants, and the existing union-equals-sinks test passes. |
| adr-2026-10-07-per-child-build-region#D1 | task | task-2 | `child-cursor.test.ts` asserts `resolveActiveChild` returns `active` child 2 for a two-child stack with no `.pipeline/coverage-binding.json` present. |
| adr-2026-10-07-per-child-build-region#D2 | task | task-9 | `stack-preflight-gating.test.ts` asserts `runStackPreflight` writes a `needs-human` `.pipeline/HALT` and emits `loop_halt` for each of `positions-changed`, `positions-ref-unreadable`, `plan-missing`, `plan-invalid`, `detached-head` and `git-error` (including git failures injected at the preflight's durable-child-state probe and at the positions-ref read), and returns `halted`, never `unavailable`, so no child region is entered. |
| adr-2026-10-07-per-child-build-region#D3 | task | task-3 | A child-lifecycle test asserts `startChild` on a sliced eligible plan with no `.pipeline/coverage-binding.json` creates `feat/c1/<slug>` and writes `refs/conductor/<slug>/positions` equal to the plan's positions. |
| adr-2026-10-07-per-child-build-region#D4 | task | task-11 | A step-registry test asserts `buildStepRegistry` for the default config places `acceptance_specs` immediately after `plan_review` and contains no `coverage_binding` step. |
| adr-2026-10-07-per-child-build-region#D5 | task | task-5 | An acceptance child-input test asserts child 2's input lists exactly Story 2 as owned, derived from the sealed plan and stories with no `.pipeline/coverage-binding.json`. |
| adr-2026-10-07-per-child-build-region#D6 | task | task-4 | `task-membership-hook.test.ts` asserts, with no `.pipeline/coverage-binding.json`, that on `feat/c1/demo` the hook's scope is tasks `1`, `2`, `3`, a commit citing task `2` exits 0 and a commit citing task `5` exits non-zero naming child 2 as owner, and a commit on the leaf `feat/daemon-demo` exits 0 unchecked. |
| adr-2026-10-07-per-child-build-region#D7 | no-change | none | Per-child `test_suite` evidence under `.pipeline/children/<k>/` is unchanged; this feature changes only where positions come from. |
| adr-2026-10-07-per-child-build-region#D8 | task | task-2 | `child-cursor.test.ts` asserts that with no `.pipeline/coverage-binding.json`, `resolveChildBase` for child 2 returns parent child 1's closure tip, `resolveSealedLeaf` returns 2 and `resolveSealedFirst` returns 1, all from the loader. |
| adr-2026-10-07-per-child-build-region#D9 | no-change | none | `build_review` child locality is unchanged; it does not read the envelope. |
| adr-2026-10-07-per-child-build-region#D10 | no-change | none | Per-child caps are unchanged; they do not read the envelope. |
| adr-2026-10-07-per-child-build-region#D11 | task | task-7 | `daemon-dashboard.test.ts` asserts a two-child stack with no `.pipeline/coverage-binding.json` renders as stacked with 2 positions, active child 2 and child 2's tasks `4`, `5`, `6`, not as flat. |
| adr-2026-10-07-per-child-build-region#D12 | no-change | none | Already lifted by `adr-2026-10-10-stacked-restack-journaled-replay` decision 9; this feature changes no rebase guard. |
| adr-2026-10-07-per-child-build-region#D13 | task | task-1, task-8, task-13 | `reseal-cli.test.ts` asserts a reseal adding slice `3` exits non-zero naming recorded `[1,2]` and proposed `[1,2,3]`, with the seal file byte-identical and the existing HALT still present. |
| adr-2026-10-07-per-child-build-region#D14 | task | task-17 | Every retained golden's diff against its pre-change version consists only of removed `coverage_binding` step lines, and the only deleted goldens are `flag-on-ineligible-coverage-binding.golden` and `flag-on-single-slice-coverage-binding.golden`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | no-change | none | Branch identity stays owned by `feature-branch-identity.ts`; unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | no-change | none | Consumers keep their non-child logic; the child arm now reads the loader, covered by the reader tasks. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | no-change | none | Attribution-is-not-authority is unchanged by this feature. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | no-change | none | The reserved `feat/c<k>` namespace probe in `child-lifecycle.ts` is unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | task | task-1 | `slice-topology.test.ts` asserts `loadSliceTopology` returns `sliced` with positions `[1,2]`, per-task positions, titles and story ownership for the two-slice fixture, and `unsliced` for a plan with no `## Slices` section. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | no-change | none | The leaf branch kind in `feature-branch-identity.ts` is unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | task | task-8 | `reseal-cli.test.ts` asserts a reseal adding slice `3` exits non-zero naming recorded `[1,2]` and proposed `[1,2,3]`, with the seal file byte-identical and the existing HALT still present. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | task | task-15 | A resume test asserts a flat feature with leftover `coverage_binding: stale` state and verdict proceeds to its next lifecycle step without re-running or reopening `coverage_binding`. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | no-change | none | Per-child region caps are unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | task | task-2 | `child-cursor.test.ts` asserts `resolveActiveChild` returns `active` child 2 for a two-child stack with no `.pipeline/coverage-binding.json` present. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | task | task-2 | `child-cursor.test.ts` asserts that with no `.pipeline/coverage-binding.json`, `resolveChildBase` for child 2 returns parent child 1's closure tip, `resolveSealedLeaf` returns 2 and `resolveSealedFirst` returns 1, all from the loader. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | no-change | none | Optional `child` on events is unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | no-change | none | Recovery CLIs keep `--child <k>`; unchanged. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | task | task-17 | The N=1 golden suite (`n1-golden-state.test.ts`, `n1-golden-renderings.test.ts`, `n1-golden-routing-guard.test.ts`) passes against the regenerated goldens. |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | no-change | none | Whole-feature rubrics still run once at the leaf; unchanged. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D1 | no-change | none | Land-rung engagement (sliced and flag on) in `land-spec.ts` is unchanged; ownership for existing children is governed by decision 6 as amended. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D2 | existing | none | `deriveStoryOwnership` in `plan-slices.ts` stays the one ownership predicate; the loader calls it unchanged. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D3 | existing | none | `evaluateStackEligibility` in `plan-slices.ts` stays the one eligibility verdict; the loader calls it unchanged. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D4 | existing | none | The `Stacked-Delivery: approved` complexity line parser is unchanged. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D5 | task | task-1, task-3 | A child-lifecycle test asserts that with no child state, a sliced plan made ineligible by `stacked_prs.enabled: false` in the repository-root config (while the feature worktree's config says true) makes `resolveActiveChild` return `no-child` and `startChild` create no child branch and no positions ref. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D6 | task | task-5 | An acceptance child-input test asserts child 2's input lists exactly Story 2 as owned, derived from the sealed plan and stories with no `.pipeline/coverage-binding.json`. |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D7 | task | task-19 | `config-consumer-registry.ts` names `slice-topology.ts`, not the `coverage_binding` runner, as the reader of `stacked_prs.enabled` and `stacked_prs.max_slices`, and the config-consumer registry test passes. |
| adr-2026-09-29-plan-slice-manifest#D1 | existing | none | The `## Slices` grammar parsed by `validatePlanSlices` is unchanged. |
| adr-2026-09-29-plan-slice-manifest#D2 | task | task-1 | `plan-slices-consumer-boundary.test.ts` asserts the production importers of `plan-slices.ts` are exactly `land-spec.ts` and `slice-topology.ts`. |
| adr-2026-09-29-plan-slice-manifest#D3 | task | task-1 | `slice-topology.test.ts` asserts engine-appended remediation task `rem-1` is in no slice's task membership. |
| adr-2026-09-29-plan-slice-manifest#D4 | existing | none | The strict Dependencies grammar for sliced plans is unchanged. |
| adr-2026-09-29-plan-slice-manifest#D5 | existing | none | The land rung `plan-slices` in `land-spec.ts` is unchanged. |
| adr-2026-09-29-plan-slice-manifest#D6 | task | task-1, task-8, task-13, task-16 | `reseal-cli.test.ts` asserts a reseal adding slice `3` exits non-zero naming recorded `[1,2]` and proposed `[1,2,3]`, with the seal file byte-identical and the existing HALT still present. |
| adr-2026-09-29-plan-slice-manifest#D7 | task | task-13 | The `ConductorEvent` union and `EVENT_SINKS` contain none of the eight removed variants, and the existing union-equals-sinks test passes. |
| adr-2026-09-29-plan-slice-manifest#D8 | existing | none | `stacked_prs.enabled` config is unchanged. |
| adr-2026-09-29-plan-slice-manifest#D9 | existing | none | The authoring-surface grammar statement and its drift test are unchanged. |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of 2–5 falsifiable checks
- [x] Dependencies are explicit and acyclic
- [x] No terminal catch-all validation task
