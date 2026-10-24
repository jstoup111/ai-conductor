**Status:** Accepted

# Stories: Stacked features resolve their children from the sealed plan; the coverage_binding step is removed (#3365, folds #3366)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/multi-child-feature-cannot-resume-after-an-operato.md`;
- `adr-2026-10-23-slice-topology-from-sealed-plan` decisions 1–7;
- the conditions of `architecture-review-2026-10-23-multi-child-feature-cannot-resume-after-an-operato`.

Terms used below:
- **Two-child stack:** a feature with slug `demo` whose sealed plan declares slices at positions `1`
  and `2`, with `stacked_prs.enabled` on and stack eligibility satisfied when the first child was
  created.
  - `refs/conductor/demo/positions` records `[1,2]`.
  - `feat/c1/demo` is closed at `refs/conductor/demo/closed/c1` and owns tasks `1`–`3` (Story 1).
  - The leaf `feat/daemon-demo` (position 2) owns tasks `4`–`6` (Story 2). It is checked out in the
    clean feature worktree `.worktrees/demo`, with `build` as its next region step.
- **Flat feature:** a feature whose plan has no `## Slices` section, or has one slice, and has no
  child branch, closure ref, or `.pipeline/children/` directory.
- **Legacy config:** a project `.ai-conductor/config.yml` that contains a top-level
  `coverage_binding:` block (`judge.enabled: false`) and a `steps.coverage_binding.llm_provider`
  entry, as feature branches cut before this change carry.
- **Leftover state:** a feature worktree whose `.pipeline/` still holds a `coverage_binding` key in
  `conduct-state.json`, `.pipeline/gates/coverage_binding.json`, `.pipeline/coverage-binding.json`,
  and `.pipeline/coverage-binding-code-stamp.json` from a run before this change.

## Story 1: An operator reseal no longer strands a stacked feature

**Requirement:** jstoup111/ai-conductor#3365 outcome 1 (ADR decisions 2–4)

As an operator, I want a stacked feature to resume its active child after I reseal an amended DECIDE artifact, so that reseal, the documented recovery for protected-artifact halts, does not stop the feature.

### Acceptance Criteria

#### Happy Path
- Given the two-child stack and an operator amendment to its plan's prose that leaves the `## Slices` positions unchanged, when the operator runs `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` and the daemon dispatches the feature, then the run resolves child 2 as the active child and runs its `build` step, with no `.pipeline` file edited by hand and no HALT written.
- Given the two-child stack and an operator amendment to its ADR and story that the reseal rebaselines, when the next dispatch runs, then child 2's region resumes at `build` and `events.jsonl` records `executor_started` followed by `step_started` for `build`, with no `halt_record_written` between them.

#### Negative Paths
- Given the two-child stack and a plan amendment that moves task `4` from slice 2 to slice 1 without changing the positions, when the operator reseals the plan, then the reseal succeeds and the next dispatch resolves child 2 with task membership read from the amended plan.
- Given the two-child stack and a plan amendment that adds a slice at position `3`, when the operator runs reseal on the plan, then reseal exits non-zero, names the recorded positions `[1,2]` and the proposed positions `[1,2,3]`, leaves the protected-artifact seal unchanged, and leaves any existing HALT in place.
- Given the two-child stack and a plan amendment that removes slice `1`, when the operator runs reseal on the plan, then reseal exits non-zero naming the recorded positions `[1,2]` and the proposed positions `[2]`, and the seal is unchanged.
- Given the two-child stack and a byte-identical reseal of its plan, when the next dispatch runs, then child 2 resumes at `build` and no step before the child region is re-run.

### Done When
- [ ] A test drives a reseal of a changed DECIDE artifact on a two-child stack through the next resume dispatch and asserts child 2's `build` step starts with no HALT.
- [ ] A test asserts reseal refuses a plan whose slice positions differ from `refs/conductor/<slug>/positions` on a feature with child state, naming both position sets, with the seal unchanged.

## Story 2: A recreated worktree resumes a stacked feature

**Requirement:** ADR decisions 2 and 4 (per-child-build-region decision 2 as amended)

As an operator, I want a stacked feature whose worktree was recreated to resume from its committed plan, so that losing the gitignored `.pipeline/` does not strand the feature.

### Acceptance Criteria

#### Happy Path
- Given the two-child stack whose worktree was recreated from `feat/daemon-demo` with an empty `.pipeline/` directory, when the daemon dispatches the feature, then the run resolves child 2 as the active child from the committed plan and the closure ref, and enters child 2's region with no HALT.

#### Negative Paths
- Given the two-child stack whose recreated worktree has a plan in which a commit after the positions were recorded moved slice positions to `[1,3]`, when the daemon dispatches the feature, then the run halts `needs-human` naming the cause `positions-changed`, the recorded positions `[1,2]` and the plan positions `[1,3]`, and enters no child region.
- Given the two-child stack whose recreated worktree has no readable plan file at the feature's plan path, when the daemon dispatches the feature, then the run halts `needs-human` naming the cause `plan-missing` and the plan path it looked for.

### Done When
- [ ] A test removes a two-child stack's `.pipeline/` directory, dispatches a resume, and asserts the active child resolves to 2 and its region is entered.
- [ ] A test asserts a plan whose positions differ from the positions ref halts with cause `positions-changed`, naming both position sets.

## Story 3: Every stacked consumer reads one slice topology from the sealed plan

**Requirement:** ADR decision 2

As the engine, I want every consumer of a stacked feature's slices to get positions, task membership, titles, and story ownership from the sealed plan, so that no consumer depends on a cache that can go stale or missing.

### Acceptance Criteria

#### Happy Path
- Given the two-child stack, when a commit on child 1's branch `feat/c1/demo` cites task `2`, then the task-membership commit hook accepts it as owned by child 1, a commit there citing task `5` is refused as owned by child 2, and a commit on the leaf `feat/daemon-demo` is not checked, exactly as before this change.
- Given the two-child stack with child 2 active, when the acceptance step builds child 2's input, then it receives Story 2 as the only owned story, derived from the sealed plan and stories.
- Given the two-child stack at its finish, when stack publication runs, then each child's PR is built from slice titles and task and story ownership read from the sealed plan, matching the positions recorded in `refs/conductor/demo/positions`.
- Given the two-child stack with `stacked_prs.enabled` turned off after child 1 was created, when the cursor resolves, then it still resolves child 2 and still reports Story 2 as owned by child 2.

#### Negative Paths
- Given the two-child stack with `.pipeline/coverage-binding.json` deleted, when the task-membership commit hook checks a commit on `feat/c1/demo` and the task CLI, the dashboard, and daemon observe read child 2's scope, then the hook uses child 1's tasks `1`–`3` and the others report child 2's tasks `4`–`6`, all from the plan, instead of treating the feature as flat.
- Given the two-child stack whose `.pipeline/coverage-binding.json` holds a stale envelope assigning task `2` to slice 2, when the commit hook checks a commit on `feat/c1/demo` citing task `2`, then it uses the sealed plan and accepts it for child 1.
- Given a sliced plan whose stories file is missing, when the topology is read on a feature with child state, then the read reports cause `plan-invalid` naming the missing stories path rather than reporting no story ownership.
- Given the two-child stack, when the plan's `## Slices` table is malformed after a reseal, then the topology read reports cause `plan-invalid` with the slice validation violations, and no consumer treats the feature as flat.
- Given a stacked feature whose plan carries engine-appended remediation task `rem-1`, when the topology is read, then `rem-1` is in no slice's task membership, as before this change.

### Done When
- [ ] Tests for the commit hook, task scope, acceptance child input, finish publication, dashboard, and observe each run against a two-child stack with no `.pipeline/coverage-binding.json` and assert the plan-derived child scope.
- [ ] A test asserts story ownership is derived with `stacked_prs.enabled` off once child state exists.
- [ ] A test asserts a stale envelope on disk does not change any consumer's result.

## Story 4: An unresolvable stacked cursor halts with its cause and a recovery command

**Requirement:** jstoup111/ai-conductor#3365 outcome 2 (ADR decision 5)

As an operator, I want a stacked feature whose active child cannot be resolved to halt with the cause and a command that recovers it, so that I never see the generic "loop ended without DONE or HALT" or have to edit `.pipeline` state by hand.

### Acceptance Criteria

#### Happy Path
- Given the two-child stack whose plan positions are `[1,3]` while the positions ref records `[1,2]`, when the daemon dispatches the feature, then `.pipeline/HALT` is written by the run with class `needs-human`, names cause `positions-changed` and both position sets, gives an `ai-conductor reseal --slug demo --path <plan> --reason "<why>" --clear-halt` command to run after restoring the positions, and `events.jsonl` records `loop_halt`.
- Given the two-child stack whose `refs/conductor/demo/positions` ref was deleted, when the daemon dispatches the feature, then the run writes a `needs-human` HALT naming cause `positions-ref-unreadable` and a `git update-ref refs/conductor/demo/positions` command that re-records the plan's positions `[1,2]`.
- Given the two-child stack whose worktree is on a detached HEAD, when the daemon dispatches the feature, then the run writes a `needs-human` HALT naming cause `detached-head` and a `git switch feat/daemon-demo` command.
- Given the two-child stack where a git invocation in cursor resolution fails, when the daemon dispatches the feature, then the run writes a `needs-human` HALT naming cause `git-error` and the command that clears the halt so the daemon re-dispatches.

#### Negative Paths
- Given any unresolvable-cursor dispatch above, when the run ends, then the daemon log does not contain "loop ended without DONE or HALT marker" for that dispatch and `.pipeline/HALT` contains the run's own cause text.
- Given the two-child stack halted with cause `positions-changed`, when the operator restores the plan's positions to `[1,2]` and runs the printed reseal command, then the next dispatch resolves child 2 and enters its region.
- Given the two-child stack halted with cause `positions-ref-unreadable`, when the operator runs the printed `git update-ref` command and clears the halt, then the next dispatch resolves child 2.
- Given a daemon re-kick of the two-child stack with an unresolvable cursor, when the re-kick's stack preflight runs, then it writes the same HALT naming the cause instead of logging `stack preflight: unavailable` and returning silently.

### Done When
- [ ] Tests for each cause (`positions-changed`, `positions-ref-unreadable`, `plan-missing`, `plan-invalid`, `detached-head`, `git-error`) assert the run writes its own `needs-human` HALT containing the cause and its recovery command, and emits `loop_halt`.
- [ ] A test runs the printed recovery for `positions-changed` and asserts the next dispatch resolves the active child.

## Story 5: Retired configuration and leftover state still load

**Requirement:** ADR decision 6

As an operator with in-flight feature branches cut before this change, I want their configuration and `.pipeline` leftovers to keep loading, so that removing the step does not halt every in-flight feature.

### Acceptance Criteria

#### Happy Path
- Given the legacy config, when the engine loads it, then loading succeeds, one warning names each of `coverage_binding` and `steps.coverage_binding` as retired and ignored, and the resolved step list contains no `coverage_binding` step.
- Given a feature worktree with leftover state, when the daemon dispatches the feature, then the run selects its next step from the current lifecycle, never selects or waits on `coverage_binding`, and does not halt because of the leftover files.
- Given a feature's `events.jsonl` containing `coverage_binding_disabled` and `plan_slices_changed` lines from before this change, when the dashboard, daemon status, and event readers load it, then they load without error.

#### Negative Paths
- Given a config with an unrelated unknown top-level key `not_a_real_key`, when the engine loads it, then loading still fails naming `not_a_real_key`.
- Given a config declaring a custom step `my_step` with no `after`, when the engine loads it, then loading still fails naming `my_step` and the missing `after`.
- Given the legacy config, when an operator runs `ai-conductor rewind --to coverage_binding`, then the command exits non-zero naming `coverage_binding` as not a step of the lifecycle, and no state is changed.

### Done When
- [ ] A test loads the legacy config and asserts success, the retired-key warnings, and no `coverage_binding` step in the registry.
- [ ] A test dispatches a feature with leftover state and asserts the next selected step is from the current lifecycle.
- [ ] Tests assert unrelated unknown top-level keys and custom steps with no `after` are still rejected.

## Story 6: Flat features and the pre-finish rebase run without the step

**Requirement:** ADR decisions 1 and 7; removes the trigger of jstoup111/ai-conductor#3366

As the engine, I want the lifecycle to run without `coverage_binding` for flat and stacked features alike, so that no step remains that a reseal can void or a rebase can reopen.

### Acceptance Criteria

#### Happy Path
- Given a flat feature with an accepted plan, when the conductor runs from `plan_review` into BUILD, then `acceptance_specs` is the step after `plan_review`, and no ref, child state, or slice event is written.
- Given the N=1 golden fixture suite, when it runs, then every retained golden differs from its pre-change version only by the removed `coverage_binding` step lines, and the only goldens removed are the two `coverage_binding` cells `flag-on-ineligible-coverage-binding.golden` and `flag-on-single-slice-coverage-binding.golden`.
- Given the two-child stack at the pre-finish `rebase` step with a base refresh that changes no DECIDE artifact, when the rebase restacks children 1 and 2, then the rebase step completes, no `coverage_binding` kickback or reopen is recorded, and the loop continues to the gates the restack reopened without a conductor state-transition error.
- Given a flat feature at the pre-finish `rebase` step whose base change touches a DECIDE artifact the feature cites, when the rebase completes, then the gates it reopens are the same as before this change apart from `coverage_binding`.
- Given a flat feature in BUILD at `build` whose ADR the operator amends and reseals, when the next dispatch runs, then BUILD continues at `build` with no `coverage_binding` step run and no HALT written.

#### Negative Paths
- Given a flat feature with leftover state recording `coverage_binding: stale`, when the conductor resumes, then it does not re-run or reopen `coverage_binding`, and proceeds to its next lifecycle step.
- Given the two-child stack at the pre-finish `rebase` step whose base change touches the feature's plan, when the rebase completes, then the loop reopens the gates the delta authorizes and does not halt with "Expected coverage_binding to match before reopen".
- Given the harness integrity check, when it runs, then the model-table presence check passes with `skills/coverage-binding/SKILL.md` present and no engine-step model-table row for `coverage_binding`.

### Done When
- [ ] The N=1 golden suite passes, with each retained golden's diff limited to the removed step lines.
- [ ] A restack test drives a two-child stack through the pre-finish `rebase` step and asserts no `coverage_binding` kickback and no state-transition error.
- [ ] `test/test_harness_integrity.sh` passes, including the model-table presence check.
