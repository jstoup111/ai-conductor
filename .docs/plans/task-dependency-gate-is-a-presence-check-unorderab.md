# Implementation Plan: Plan dependency graphs must resolve before a new plan passes its authoring gates

**Date:** 2026-11-05
**Stories:** .docs/stories/task-dependency-gate-is-a-presence-check-unorderab.md
**Conflict check:** Clean as of 2026-11-05 (.docs/conflicts/task-dependency-gate-is-a-presence-check-unorderab.md)

## Summary

This plan adds acyclicity checking and a single strict-validation entry to `plan-dependencies.ts`. It enforces that entry at a new land rung for every plan, and at the conduct `plan` gate for plans that are absent at the merge-base. Daemon backlog eligibility is left untouched, and the `/plan` skill is updated to state the rule. There are 8 tasks.

## Technical Approach

- **Owner.** `src/conductor/src/engine/plan-dependencies.ts` already owns `parsePlanDependencyGraph`, which reports `dependencies-line`, `malformed-dependencies` and `unknown-dependency` violations. Task ids resolve only through `resolvePlanTaskReference` (`adr-2026-08-30-shared-plan-task-reference-resolver` D1). This plan adds two pure functions there:
  - `findDependencyCycles(dependenciesByTaskId)` returns every unorderable set: each strongly connected component with more than one member, plus every self-dependency. Members are sorted by plan order.
  - `validatePlanDependencies(planText)` returns `parsePlanDependencyGraph` violations, minus those whose `taskId` satisfies `isEngineAppendedRemediationTaskId` (`remediation-append.ts`), plus one `dependency-cycle` violation per cycle. Each cycle message names every member id.
  - The grammar is unchanged (architecture review condition C4).
- **Land.** `engineer/land-spec.ts` `landSpec` gains rung `plan-dependencies`, a new `LandGateIdentifier` member in `src/conductor/src/types/land.ts`. It runs immediately after the `plan-slices` rung, so a plan that already fails slice validation reports only that error. It throws `landGateError('plan-dependencies', …)` with every violation message joined by `; `.
- **Plan gate.** `GATE_ONLY_PREDICATES.plan` in `artifacts.ts` keeps all of its existing coverage checks. Its final dependency check becomes:
  - resolve whether the scoped plan's repo-relative path exists at the merge-base;
  - `absent`: run `validatePlanDependencies`, and on any violation return `{ done: false, reason }` naming the violations;
  - `present`: run today's `planHasDependencyTree` presence check unchanged;
  - `merge-base-unresolved`: run the presence check. If it fails, keep today's reason. If it passes, return `{ done: true, reason }` stating that strict dependency validation was skipped because the merge-base was unresolved.
- **Merge-base.** Focused local pattern basis: `resolveMergeBase` in `adr-assumption-ledger-scope.ts` already answers "what does this feature's branch diverge from".
  - Traits to keep: compare with `origin/«default»` when that ref exists, else the local default branch; return a typed resolved/unresolved result and never throw.
  - Allowed variation: the caller decides the fallback.
  - Search hints: `resolveMergeBase`, `originDefaultBranch`, `makeGitRunner` in `rebase.ts`.
  - Add one exported helper, `artifactPresenceAtMergeBase(worktreePath, repoRelPath)`. It reuses `resolveMergeBase` and `git cat-file -e «sha»:«path»`, and returns `present | absent | merge-base-unresolved`. Do not add a second merge-base resolver.
  - `artifacts.ts` already imports this module, so no new import edge is created.
- **Unchanged.** `daemon-backlog.ts`, `planHasDependencyTree`, `validatePlanSlices`, `plan-review-candidates.ts` (C3).
- **Fixtures.** Roughly ten existing land test files seed plans whose task headings have no `**Dependencies:**` line. They must gain `**Dependencies:** none` lines (Task 4) or they will fail the new rung. Plan-gate tests use non-git temp directories, so the merge-base is unresolved and they keep the presence path.
- **Sequencing.** Parser (Tasks 1, 2), then land rung (Task 3) and fixture migration (Task 4), then merge-base helper and gate (Tasks 5, 6). The backlog pin and the skill text (Tasks 7, 8) depend only on Task 2.

## Prerequisites

- None. No migration, config, schema, CLI, hook or settings change.

## Tasks

### Task 1: Detect dependency cycles in a parsed dependency graph
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-dependencies.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `findDependencyCycles(dependenciesByTaskId)` in `plan-dependencies.ts` as Tarjan's strongly-connected-components pass. It returns each component of size > 1 and each self-dependency, as arrays of task ids in map-insertion order. Ignore edges to ids absent from the map, because dangling ids are already reported by the parser.
4. Verify GREEN and commit.

**Done when:**
- [test] `findDependencyCycles` returns exactly `[["1","2"]]` for a graph where Task 1 depends on Task 2 and Task 2 depends on Task 1.
- [test] `findDependencyCycles` returns exactly `[["3","5","7"]]` for a three-task cycle 3→5→7→3 beside an independent Task 1, and Task 1 appears in no returned set.
- [test] `findDependencyCycles` returns exactly `[["2"]]` for a graph where Task 2 depends on itself.
- [test] `findDependencyCycles` returns `[]` for an acyclic graph with a diamond (Task 4 depends on Tasks 2, 3; both depend on Task 1).

**Files likely touched:**
- `src/conductor/src/engine/plan-dependencies.ts` — add `findDependencyCycles`
- `src/conductor/test/engine/plan-dependencies.test.ts` — cycle tests

**Dependencies:** none

### Task 2: Strict plan dependency validation entry
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/plan-dependencies.test.ts` for every Done-when check below.
2. Verify RED.
3. Implement `validatePlanDependencies(planText)` in `plan-dependencies.ts`. It returns the `parsePlanDependencyGraph` violations whose `taskId` is not an engine-appended remediation id (`isEngineAppendedRemediationTaskId`, as `plan-slices.ts` filters them), followed by one `{ code: 'dependency-cycle', taskId: «first member», message }` per `findDependencyCycles` result. The message reads `Tasks «a», «b», … form a dependency cycle and cannot be ordered` and names every member. Extend `PlanDependencyViolation['code']` with `'dependency-cycle'`. Leave `parsePlanDependencyGraph` itself unchanged, so `plan-slices.ts` and `plan-review-candidates.ts` behave as today.
4. Verify GREEN and commit.

**Done when:**
- [test] `validatePlanDependencies` returns `[]` for an acyclic plan whose every task declares one `none` or task-reference line, including a plan with remediation tasks (`rem-…` ids) that carry no `**Dependencies:**` line.
- [test] `validatePlanDependencies` returns one `dependency-cycle` violation whose message contains Task ids 1 and 2 for a two-task cycle, one whose message contains 3, 5 and 7 but not 1 for a three-task cycle beside an independent Task 1, and one whose message contains Task 2 for a Task 2 that depends on itself.
- [test] `validatePlanDependencies` returns an `unknown-dependency` violation whose message contains both `Task 99` and `Task 2` when Task 2 cites a nonexistent Task 99.
- [test] `validatePlanDependencies` returns, for every non-remediation task, a `dependencies-line` violation whose message names that task, for a plan that has a `## Task Dependency Graph` section but no per-task `**Dependencies:**` lines.
- [test] `validatePlanDependencies` returns a `malformed-dependencies` violation naming the task and containing `expected "none" or comma-separated task references` for a `Tasks 1–9` line and for an `all prior` line.

**Files likely touched:**
- `src/conductor/src/engine/plan-dependencies.ts` — add `validatePlanDependencies`, `dependency-cycle` code
- `src/conductor/test/engine/plan-dependencies.test.ts` — validation tests

**Dependencies:** Task 1

### Task 3: Land rung `plan-dependencies` rejects unresolvable plan graphs
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/engineer/land-spec-plan-dependencies.test.ts` for every Done-when check below. Seed the git fixture the way `land-spec-plan-slices.test.ts` seeds it.
2. Verify RED.
3. Add `'plan-dependencies'` to `LandGateIdentifier` in `src/conductor/src/types/land.ts`. In `landSpec`, immediately after the `plan-slices` rung, call `validatePlanDependencies(planContent)`. On any violation, throw `landGateError('plan-dependencies', \`landSpec: ${messages.join('; ')}\`)` before any commit.
4. Verify GREEN and commit.

**Done when:**
- [test] `landSpec` on an unsliced plan with a two-task cycle rejects with a `LandGateError` whose `gate` is `plan-dependencies` and whose message names both task ids, and the `spec/«slug»` branch does not exist afterward.
- [test] `landSpec` rejects with gate `plan-dependencies` naming the citing task and the missing id for an unsliced plan citing a nonexistent task, and naming each task missing a line for an unsliced plan with only a `## Task Dependency Graph` section.
- [test] `landSpec` on a sliced plan that passes `plan-slices` but has a same-slice cycle rejects with gate `plan-dependencies` naming the cycle members.
- [test] `landSpec` on a sliced plan with a malformed slice manifest that also contains a two-task cycle rejects with gate `plan-slices` carrying the unchanged slice refusal message, and that message contains no `dependency cycle` text.
- [test] `landSpec` commits a conforming unsliced plan and a conforming sliced plan, each resolving with `branch` `spec/«slug»`.

**Files likely touched:**
- `src/conductor/src/engine/engineer/land-spec.ts` — new rung after `plan-slices`
- `src/conductor/src/types/land.ts` — `LandGateIdentifier` member
- `src/conductor/test/engine/engineer/land-spec-plan-dependencies.test.ts` — new rung tests

**Dependencies:** Task 2

### Task 4: Bring existing land fixtures onto the enforced dependency grammar
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Run the land test files listed under Files and find each one that fails on the new `plan-dependencies` rung.
2. Give each seeded plan task heading a `**Dependencies:** none` line, or a valid task reference where the fixture's intent needs one. Leave fixtures that deliberately test another rung failing on that rung.
3. In `land-spec-plan-slices.test.ts`, change the free-form `Tasks 1–9 all passing` case so that it expects rejection with gate `plan-dependencies` and still asserts `validatePlanSlices` returned `{ kind: 'unsliced' }`. Change the section-only case so that it expects no `plan-slices` refusal.
4. Commit.

**Done when:**
- [test] In `land-spec-plan-slices.test.ts`, the free-form `Tasks 1–9 all passing` case asserts `validatePlanSlices` last returned `{ kind: 'unsliced' }` and the land rejection's `gate` is `plan-dependencies`, for `stacked_prs.enabled` both false and true.
- [test] In `land-spec-plan-slices.test.ts`, the task-less `## Task Dependency Graph` case still lands with branch `spec/plan-slices`.
- Every file under Files passes its own targeted vitest run with no test deleted or skipped.

**Files likely touched:**
- `src/conductor/test/engine/engineer/land-spec-plan-slices.test.ts`
- `src/conductor/test/engine/engineer/land-spec.test.ts`
- `src/conductor/test/engine/engineer/land-spec-manifest.test.ts`
- `src/conductor/test/engine/engineer/land-spec-applicability.test.ts`
- `src/conductor/test/engine/engineer/land-spec-adr-assumption-ledger.test.ts`
- `src/conductor/test/engine/engineer/land-spec-story-readability.test.ts`
- `src/conductor/test/engine/engineer/engineer-cli-land-dependencies.test.ts`
- `src/conductor/test/engine/engineer/engineer-cli-land-manifest-event.test.ts`
- `src/conductor/test/engine/story-criteria.test.ts`
- `src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts`
- `src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts`

**Dependencies:** Task 3

### Task 5: Resolve whether a plan file exists at the feature's merge-base
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/artifact-presence-at-merge-base.test.ts` for every Done-when check below. Use a temporary git repository with a default branch and a feature branch.
2. Verify RED.
3. In `adr-assumption-ledger-scope.ts`, add exported `artifactPresenceAtMergeBase(worktreePath, repoRelPath)`. It returns `{ kind: 'present' } | { kind: 'absent' } | { kind: 'merge-base-unresolved'; detail }`. Reuse the module's existing `resolveMergeBase`: same origin-first comparison base and typed unresolved result, never throwing. Test existence with `git cat-file -e «sha»:«repoRelPath»`.
4. Verify GREEN and commit.

**Done when:**
- [test] `artifactPresenceAtMergeBase` returns `absent` for a plan file added only on the feature branch after it diverged from the default branch.
- [test] `artifactPresenceAtMergeBase` returns `present` for a plan file committed on the default branch before the feature branch diverged, including after the feature branch appends text to it.
- [test] `artifactPresenceAtMergeBase` returns `merge-base-unresolved` with a non-empty `detail`, without throwing, in a directory that is not a git repository.

**Files likely touched:**
- `src/conductor/src/engine/adr-assumption-ledger-scope.ts` — export the presence helper
- `src/conductor/test/engine/artifact-presence-at-merge-base.test.ts` — new tests

**Dependencies:** none

### Task 6: The conduct plan gate validates newly authored plans strictly
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/plan-gate-dependencies.test.ts` for every Done-when check below. Use git fixtures with a default branch and a feature branch, each with a stories file and a plan that the existing coverage checks accept. Call through `checkGateCompletion(dir, 'plan', { featureDesc })`, the gate-verdict entry point.
2. Verify RED.
3. In `GATE_ONLY_PREDICATES.plan` in `artifacts.ts`, replace the final `planHasDependencyTree` check with the branch described in Technical Approach. It is keyed on `artifactPresenceAtMergeBase(dir, «scoped plan repo-relative path»)`: strict `validatePlanDependencies` when `absent`; the unchanged presence check when `present`; when `merge-base-unresolved`, the presence check plus a skipped-validation `reason` on success.
4. Verify GREEN and commit.

**Done when:**
- [test] `checkGateCompletion(dir, 'plan', …)` returns `done: false` with a `reason` containing every cycle member id for a cyclic plan added on the feature branch, and `done: true` for a conforming plan added on the feature branch.
- [test] `checkGateCompletion(dir, 'plan', …)` returns `done: false` with a `reason` naming the citing task and the missing id for a new plan citing a nonexistent task, and naming each task missing a line for a new section-only plan.
- [test] `checkGateCompletion(dir, 'plan', …)` returns `done: true` for a plan with `Tasks 1–9` lines committed on the default branch before divergence, both as-is and after the feature branch appends a `### Task rem-…` remediation task with no `**Dependencies:**` line.
- [test] In a non-git fixture, `checkGateCompletion(dir, 'plan', …)` returns `done: true` with a `reason` containing `merge-base` and `skipped` for a plan carrying a `## Task Dependency Graph` section, and returns `done: false` with the existing `plan has no task dependency tree` reason for a plan with neither a section nor any line.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — plan gate dependency branch
- `src/conductor/test/engine/plan-gate-dependencies.test.ts` — new gate tests

**Dependencies:** Task 2, Task 5

### Task 7: Pin daemon backlog dependency eligibility as presence-only
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Add tests to `src/conductor/test/engine/daemon-backlog.test.ts` for the Done-when checks below. Reuse the file's existing merged-spec fixture helpers.
2. Confirm that `src/conductor/src/engine/daemon-backlog.ts` is untouched by this feature's diff, then commit the tests.

**Done when:**
- [test] Backlog discovery lists as eligible a merged spec whose plan carries `**Dependencies:** Tasks 1–9`, `**Dependencies:** none (parallel with 1–6)` and bare-id `**Dependencies:** 1-11` lines, and one whose plan has a Task 1 ↔ Task 2 cycle.
- The existing `no-dependency-tree` backlog test passes with its asserted reason, remedy and warning text unchanged, and `git diff «merge-base» -- src/conductor/src/engine/daemon-backlog.ts` is empty.

**Files likely touched:**
- `src/conductor/test/engine/daemon-backlog.test.ts` — pinning tests

**Verify-only:** yes

**Dependencies:** Task 2

### Task 8: The plan skill states the enforced dependency rule
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/plan-dependencies-skill-contract.test.ts` for every Done-when check below.
2. Verify RED.
3. Edit `skills/plan/SKILL.md` in four places:
   - Replace the §1 precondition item ("Every task carries a `**Dependencies:**` line … or the plan includes a `## Task Dependency Graph` section …") with the enforced rule: one `none` or comma-separated task-reference line per task (remediation tasks excepted), every cited id declared, the graph acyclic, enforced at land and at the conduct `plan` gate for new plans.
   - Describe the Plan Format's `## Task Dependency Graph` section as an optional diagram alongside the per-task lines.
   - In both verification checklists, keep "Dependencies are explicit and acyclic" (or "declared and acyclic") and the separate non-interference item pointing to plan review, as `no-decide-sweep-covers-task-versus-task-oscillatio` Story 3 requires.
   - Keep every example `**Dependencies:**` line in the strict grammar.
4. Verify GREEN, plus the existing `plan-slices-skill-contract.test.ts` and `plan-interference-check-skill-contract.test.ts`, and commit.

**Done when:**
- [test] The contract test asserts `skills/plan/SKILL.md` does not contain `or the plan includes a \`## Task Dependency Graph\` section`, and that every prose line of the skill (outside fenced blocks) mentioning `Task Dependency Graph` also contains `optional`, so no line presents the section as sufficient on its own.
- [test] The contract test asserts the skill's §1 dependency precondition item contains `exactly one`, `none`, `comma-separated`, `task reference`, `remediation`, `declared`, `acyclic`, `land`, and `` `plan` gate ``.
- [test] The contract test extracts every `**Dependencies:**` line in `skills/plan/SKILL.md` except the one format-template placeholder `**Dependencies:** [Task N that must complete first, or "none"]`, and asserts each value is exactly `none` or a comma-separated list of optionally `Task`/`Tasks`-prefixed ids (`[A-Za-z0-9._-]+`) with no other words and no id matching a numeric range `\d+\s*[–-]\s*\d+` (so neither `Tasks 1–9` nor `Tasks 1-9` passes), and that `validatePlanDependencies` returns `[]` for the skill's fenced sliced-plan example.
- [test] The existing `plan-slices-skill-contract.test.ts` and `plan-interference-check-skill-contract.test.ts` pass, and both checklists still list the acyclic item and a separate non-interference item naming plan review.

**Files likely touched:**
- `skills/plan/SKILL.md` — dependency precondition, format note, checklists
- `src/conductor/test/engine/plan-dependencies-skill-contract.test.ts` — new contract test

**Dependencies:** Task 2

## Task Dependency Graph

```
1 → 2 → 3 → 4
        2 → 6
5 ────────→ 6
        2 → 7
        2 → 8
```

## Integration Points

- After Task 3: `ai-conductor compose land` rejects an unorderable plan end to end.
- After Task 6: the conduct `plan` gate verdict (`computeAndWriteVerdict`) rejects a newly authored unorderable plan.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-29-plan-slice-manifest#D1 | no-change | none | The `## Slices` table grammar is untouched; no task edits `plan-slices.ts`. |
| adr-2026-09-29-plan-slice-manifest#D2 | task | task-7 | The existing `no-dependency-tree` backlog test passes with its asserted reason, remedy and warning text unchanged |
| adr-2026-09-29-plan-slice-manifest#D3 | existing | none | `isEngineAppendedRemediationTaskId` exemption already exists in `remediation-append.ts`; Task 2 reuses it unchanged. |
| adr-2026-09-29-plan-slice-manifest#D4 | task | task-2, task-3, task-6 | rejects with a `LandGateError` whose `gate` is `plan-dependencies` and whose message names both task ids |
| adr-2026-09-29-plan-slice-manifest#D5 | task | task-3 | rejects with gate `plan-slices` carrying the unchanged slice refusal message |
| adr-2026-09-29-plan-slice-manifest#D6 | no-change | none | The `coverage_binding` slice layer was removed by #3365; this feature touches neither it nor `slice-topology.ts`. |
| adr-2026-09-29-plan-slice-manifest#D7 | no-change | none | `plan_slices_changed` was removed by #3365; no event is added or changed. |
| adr-2026-09-29-plan-slice-manifest#D8 | no-change | none | `stacked_prs` config is untouched. |
| adr-2026-09-29-plan-slice-manifest#D9 | task | task-8 | `validatePlanDependencies` returns `[]` for the skill's fenced sliced-plan example |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions; plan review sweeps this at Medium and Large tier
