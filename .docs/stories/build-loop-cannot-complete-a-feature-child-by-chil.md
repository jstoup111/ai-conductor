**Status:** Accepted

# Stories: Per-child BUILD region for stacked features (#2942)

Technical track (no PRD). Source: the scope boundary in
`.docs/track/build-loop-cannot-complete-a-feature-child-by-chil.md` (items 1–9) and
`adr-2026-10-07-per-child-build-region` (decisions 1–14).

Terms used below:
- **Stacked feature:** a feature whose project resolves `stacked_prs.enabled: true` and whose sealed
  `coverage_binding` envelope records two or more slice positions for a plan that passed stack
  eligibility (#3039).
- **Two-child baseline:** a stacked feature with slug `demo`, positions `1` and `2`, story `1` owned
  by child 1 (tasks `T1`, `T2`), story `2` owned by child 2 (tasks `T3`, `T4`), `build_review`
  enabled, and the leaf branch `feat/daemon-demo` created by the daemon at base SHA `B`, with no
  commits on it before the region.
- **Three-child baseline:** the same, with positions `1`, `2` and `3` and story `3` owned by child 3
  (task `T5`).
- **Closure ref:** `refs/conductor/<slug>/closed/c<k>`.
- **Child directory:** `.pipeline/children/<k>/`.

## Story 1: The active child is derived from git and survives restarts

**Requirement:** Scope item 1; ADR decisions 1–2

As an operator, I want the engine to know which child it is building from durable git state, so that
a daemon restart, a re-kick or a recreated worktree never re-runs a finished child or skips an
unfinished one.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline in which child 1's region has passed and `refs/conductor/demo/closed/c1`
  exists, when the daemon restarts and resumes the feature, then the next dispatched step is child 2's
  `acceptance_specs` and child 1's region steps are not dispatched again.
- Given a three-child baseline in which children 1 and 2 are closed and child 3 is mid-`build`, when
  `.worktrees/demo` is removed and recreated from the leaf branch and the feature resumes, then
  `coverage_binding` re-seals the envelope and the next region step dispatched is child 3's
  `acceptance_specs`. Child 3's gitignored region evidence does not survive recreation.
- Given a two-child baseline in which child 1 is closed by a closure ref whose tip has no commits past
  its parent (an empty child), when the feature resumes, then child 1 stays closed and child 2 is
  active.

#### Negative Paths
- Given a two-child baseline in which `feat/c1/demo` has just been created at `B` with no commits and
  no closure ref, when the daemon restarts, then child 1 is still the active child, even though the
  leaf branch contains child 1's tip.
- Given a three-child baseline with child 1 closed, when an operator commits directly onto
  `feat/c1/demo` so that its tip is no longer an ancestor of `feat/c2/demo`, then the next dispatch
  halts needs-human naming child 1 and "restack required (#2943)", and no region step runs.
- Given a two-child baseline with child state present, when the region is about to dispatch and the
  `coverage_binding` envelope is absent, then the run halts needs-human naming the missing envelope,
  and no region state is written to the flat `.pipeline/` paths.
- Given a two-child baseline in which the worktree is in detached HEAD, when the cursor is resolved,
  then the run halts needs-human naming the detached HEAD rather than treating the feature as having
  no child.

### Done When
- [ ] Restarting, re-kicking or recreating the worktree of a two- or three-child feature resumes at the
      lowest position with no closure ref.
- [ ] Closure refs are created only by compare-and-swap and are never pushed to `origin`.
- [ ] A divergent closed child, a missing envelope with child state, and a detached HEAD each halt
      needs-human with the cause named, and none of them writes a flat region file.

## Story 2: Children are created and switched strictly in declared order

**Requirement:** Scope item 2; ADR decisions 3 and 13

As an operator, I want each child built on its own branch in declared order, so that no task of child
k+1 starts before child k has passed its whole region.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline at `coverage_binding` PASS, when the region is entered, then
  `feat/c1/demo` is created at `B`, the worktree is switched to it, `.pipeline/children/1/` exists,
  and a `child_started` event with `child: 1` is persisted to `.pipeline/events.jsonl`.
- Given a three-child baseline in which child 1's `acceptance_specs`, `build`, `test_suite` and
  `build_review` have all passed, when the loop reaches the region exit, then
  `refs/conductor/demo/closed/c1` points at child 1's tip, `feat/c2/demo` is created at that tip, the
  worktree is switched to it, `current-task` is cleared, and `child_closed` (child 1),
  `child_switched` (1→2) and `child_started` (child 2) are persisted in that order.
- Given a two-child baseline in which a pre-region halt record was committed on `feat/daemon-demo`
  at `H` and the halt was cleared, when the region is entered, then `feat/c1/demo` is created at `H`,
  and the later leaf move succeeds because the leaf has no commits of its own.
- Given a stacked feature with positions `1`, `3` and `5` (gaps; `5` is the leaf), when child 1
  closes, then the next child created is `feat/c3/demo` and no `feat/c2/demo` is created.

  > **Amended 2026-10-10 by #3053:** the criterion previously named positions `1` and `3` only,
  > which makes position `3` the leaf. adr-2026-10-07-per-child-build-region decision 3 creates no
  > branch for the leaf (it runs on `feat/daemon-demo` after the leaf move), so the example now adds
  > a leaf at position `5`, matching the plan's tests and the shipped behavior.

#### Negative Paths
- Given a three-child baseline in which child 1's `build_review` has not passed, when the loop
  selects its next step, then no `feat/c2/demo` branch is created and no task of child 2 is
  dispatched.
- Given a two-child baseline in which a branch named exactly `feat/c1` already exists, when the
  region is entered, then the run halts needs-human naming `refs/heads/feat/c1`, and no
  `feat/c1/demo` branch is created.
- Given a three-child baseline in which child 1 closes while the worktree holds an uncommitted change
  to `src/a.ts`, when the switch to child 2 is attempted, then the switch is refused naming
  `src/a.ts`, no `git stash` entry is created, and the change is still in the worktree.
- Given a stacked feature whose envelope records 3 positions while the project config now sets
  `stacked_prs.max_slices: 2`, when the first child would be created, then the run halts needs-human
  naming `stacked_prs.max_slices`, and no child branch is created.
- Given a three-child baseline in which `feat/c2/demo` was created by another process between the
  probe and the creation, when the engine creates it, then the compare-and-swap fails and the run
  halts needs-human naming the branch instead of overwriting it.

### Done When
- [ ] Child branches are created only at their parent's closure tip (child 1 at the leaf's tip at
      region entry), in declared order, gaps respected.
- [ ] A dirty tree refuses the switch with the paths named, and no switch path invokes autostash.
- [ ] A reserved-namespace conflict, a `max_slices` breach and a lost compare-and-swap each halt
      before any branch is written.

## Story 3: The leaf takes over after the last intermediate child

**Requirement:** Scope item 2; ADR decision 3

As an operator, I want the feature's existing leaf branch to carry the last child, so that the leaf
keeps today's name and retained draft while containing every child's work.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline in which child 1 closes at tip `C1` and `feat/daemon-demo` is still at
  `B`, when the loop moves to child 2, then `feat/daemon-demo` points at `C1`, the worktree is on
  `feat/daemon-demo`, and no `feat/c2/demo` branch exists.
- Given a three-child baseline in which the leaf's region passes, when the loop continues, then the
  next step is the first whole-feature step after `build_review` (e.g. `manual_test`), run on
  `feat/daemon-demo`.

#### Negative Paths
- Given a two-child baseline in which `feat/daemon-demo` has gained a commit of its own (not in
  `C1` or `origin/main`) before child 1 closes, when the leaf move is attempted, then the run halts
  needs-human naming the leaf branch and its extra commit, and the leaf ref is unchanged.
- Given a two-child baseline in which the leaf ref changes between the guard check and the move, when
  the move runs, then the compare-and-swap fails, the run halts needs-human, and the leaf is not
  overwritten.

### Done When
- [ ] The leaf branch is moved only by a guarded compare-and-swap to the last intermediate child's
      closure tip.
- [ ] A leaf with its own commits, or a raced leaf, halts with the leaf ref unchanged.

## Story 4: Region state lives with its child and is never written flat while children exist

**Requirement:** Scope item 4; ADR decisions 2 and 4

As an operator, I want each child's step status, verdicts and evidence kept apart, so that no child
overwrites another's and flat readers never see a mix.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline in which child 1 has passed `test_suite`, when child 2's `test_suite` then
  fails, then `.pipeline/children/1/gates/test_suite.json` still records PASS and
  `.pipeline/children/2/gates/test_suite.json` records FAIL.
- Given a two-child baseline with child 2 active, when the selector, resume, `ai-conductor daemon
  status` and the dashboard read step state, then they report child 2's region status and the
  feature's flat whole-feature status together.
- Given a two-child baseline with child 2 active, when `manual_test` kicks back to `build`, then the
  `build` demotion is written to child 2's (the leaf's) state, and child 1's state is unchanged.

#### Negative Paths
- Given a two-child baseline with child state present, when the flat verdict lister or flat
  test-suite evidence probe runs, then entries under `.pipeline/children/` are not included. Only
  the overlay reads child state.
- Given a two-child baseline with child state present, when `stacked_prs.enabled` is turned off and the
  feature resumes, then region state is still read from and written to the active child's directory,
  and no file under `.pipeline/gates/` for a region step is created or modified.
- Given a two-child baseline with child 2 active, when a rebase invalidates `build_review`, then the
  stale mark lands in child 2's state, and `.pipeline/conduct-state.json` gains no region key.
- Given a two-child baseline, when a whole-feature gate's kickback targets `plan` or
  `coverage_binding`, then it behaves exactly as today and no child state is changed.

### Done When
- [ ] Every region read goes through one overlay and every region write through the routed state
      port, proven by a test that fails if any flat region key changes while children exist.
- [ ] Whole-feature kickbacks, stale cascades and rebase invalidations into a region step land in the
      active (leaf) child's state.

## Story 5: Acceptance specs cover only the stories the child owns

**Requirement:** Scope item 3; ADR decisions 5 and 8

As an operator, I want each child's acceptance specs to cover only its own stories, so that every
child's tree can be green on its own and a later child never invalidates an earlier child's
acceptance.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline at child 1's `acceptance_specs`, when the `writing-system-tests` skill is
  dispatched, then its inputs name only story `1`'s criteria, and the RED marker and run contract are
  written under `.pipeline/children/1/`.
- Given a two-child baseline at child 2's `acceptance_specs`, where every story-2 criterion is
  disposed (no spec files changed since child 1's tip), when the completion check runs, then
  disposition-only completion passes against story `2`'s criteria alone.
- Given a stacked feature whose child 1 owns no story (infrastructure tasks only), when child 1's
  `acceptance_specs` completes, then its verdict records outcome `no-owned-criteria` and the region
  proceeds to `build`.

#### Negative Paths
- Given a two-child baseline at child 2's `acceptance_specs`, when the disposition record omits a story
  `2` criterion, then completion fails naming the omitted criterion id.
- Given a two-child baseline at child 2's `acceptance_specs`, when the disposition record also lists a
  story `1` criterion, then completion fails naming that criterion as not owned by child 2.
- Given a two-child baseline at child 2's `acceptance_specs` in which child 1 committed spec files,
  when disposition-only completion is evaluated, then child 1's spec files are not attributed to child
  2 and do not refuse it.
- Given a two-child baseline at child 2's `acceptance_specs` in which `feat/c1/demo` is missing, when
  spec attribution is evaluated, then disposition-only completion is refused naming the missing
  parent.
- Given a stacked feature whose child 2 owns stories, when its RED marker reports `failed: 0` and no
  recorded-RED exception is present, then completion fails as today.
- Given a two-child baseline at child 2's `acceptance_specs` in which a story-2 spec already passes
  because child 1 implemented that behavior, when the RED marker records a `prior-child-green`
  exception attributed to child 1's closure tip, then completion accepts it. The same exception
  attributed to any other SHA is refused, naming the attribution.

### Done When
- [ ] The acceptance predicate, disposition grounding, spec attribution, RED marker and run contract
      are all scoped to the active child, and the shipped `writing-system-tests` skill receives and
      writes child-scoped inputs and paths.
- [ ] A child with zero owned stories completes with `no-owned-criteria`.
- [ ] Child 1's acceptance verdict is unchanged after child 2's acceptance runs.

## Story 6: Build completes, and stalls, on the child's own tasks

**Requirement:** Scope item 3; ADR decision 6

As an operator, I want `build` for child k to complete when child k's tasks are done, so that later
children's pending tasks never block or falsely stall an earlier child.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline at child 1's `build`, when `T1` and `T2` are resolved and `T3`, `T4` are
  pending, then child 1's `build` completes.
- Given a two-child baseline in which a remediation task `rem-1` is appended while child 2 is active,
  when child 2's `build` completion is evaluated, then `rem-1` is part of child 2's task set, and its
  child is recorded beside the appended-id record.

#### Negative Paths
- Given a two-child baseline at child 1's `build`, when `T2` is unresolved, then completion fails
  naming `T2` as pending and does not name `T3` or `T4`.
- Given a two-child baseline at child 2's `build`, when a dispatch resolves no child-2 task and HEAD
  did not move, then it is recorded as `no_task_progress` even though child 1's tasks are all resolved.
- Given a two-child baseline at child 2's `build`, when a dispatch resolves no child-2 task but HEAD
  moved, then it is not recorded as `no_task_progress`, as today.
- Given a two-child baseline in which a remediation task's recorded child is missing, when child 2's
  `build` completion is evaluated, then completion fails closed naming the task.

### Done When
- [ ] The build predicate and the stall breaker fold over the active child's slice tasks plus the
      remediation tasks recorded to that child.
- [ ] Each remediation task appended during a stacked build records its child.

## Story 7: Commits stay in the child that owns the task

**Requirement:** Scope item 5; ADR decision 6

As an operator, I want a commit refused when its task belongs to a different child than the checked-out
branch, so that each child's diff contains only its own work.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline with `feat/c1/demo` checked out, when a commit carries `Task: T1`, then
  the commit-msg hook accepts it.
- Given a feature with no children on `feat/daemon-other`, when a commit carries any valid task id,
  then the hook behaves exactly as today and the membership check abstains.

#### Negative Paths
- Given a two-child baseline with `feat/c1/demo` checked out, when a commit carries `Task: T3`, then
  the hook rejects it, naming task `T3`, child 2 as its owner and child 1 as the checked-out child,
  and no commit is created.
- Given a two-child baseline with `feat/c1/demo` checked out, when `.pipeline/current-task` still holds
  `T3` from an earlier session, then the stamped `Task: T3` commit is rejected the same way.
- Given a two-child baseline with `feat/c1/demo` checked out, when the membership source cannot be read
  (missing envelope), then the hook rejects the commit naming the unreadable membership.
- Given a two-child baseline, when an engine commit runs with `CONDUCT_ENGINE_COMMIT` set, then the
  membership check is bypassed exactly as the existing scope check is.

### Done When
- [ ] `ai-conductor task-membership-check` exists, reads the checked-out ref, and is called by the
      installed commit-msg hook.
- [ ] Refusals name the task, its owning child and the checked-out child, and they fail closed on a
      child branch.

## Story 8: Test-suite evidence is per child; the aggregate runs once, at the leaf

**Requirement:** Scope item 3; ADR decisions 7–8

As an operator, I want each child's `test_suite` validated against that child's changes, and the
aggregate suite run once for the feature, so that each increment is green without N aggregate runs.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline with `full_suite: once` at child 1's `test_suite`, when the scoped run
  passes, then `.pipeline/children/1/test-suite-evidence.json` records the PASS with child 1's base,
  and no aggregate run is required.
- Given a two-child baseline with `full_suite: once` at the leaf's `test_suite`, when it runs, then an
  aggregate PASS is required and recorded in the leaf's evidence.
- Given a two-child baseline at the FINISH fence, when the fence re-verifies `test_suite`, then it
  reads and writes the leaf child's evidence and verdict, and complete-verifier accepts the leaf's
  evidence.

#### Negative Paths
- Given a two-child baseline at child 2's `test_suite`, when the scoped selection's base is
  unresolvable (`feat/c1/demo` missing), then the run falls back to the aggregate suite as the
  full-suite site's fail-closed policy requires.
- Given a two-child baseline at the FINISH fence, when the leaf's evidence has no aggregate PASS, then
  the fence fails as today and no flat `.pipeline/test-suite-evidence.json` is written.
- Given a two-child baseline in which child 1's evidence records an aggregate PASS, when the leaf's
  `test_suite` runs under `full_suite: once`, then child 1's PASS does not satisfy the leaf's aggregate
  requirement.

### Done When
- [ ] `FullSuiteVerifier`, the FINISH fence, complete-verifier and build-review inputs read the
      active child's evidence path.
- [ ] Under `full_suite: once`, exactly one aggregate PASS is required per stacked feature, at the
      leaf.

## Story 9: Build review grades the child's own diff against its parent's tip

**Requirement:** Scope item 3; ADR decisions 8–9

As a reviewer, I want each child's `build_review` to grade only that child's changes, so that review
findings and laps belong to the increment that introduced them.

### Acceptance Criteria

#### Happy Path
- Given a three-child baseline at child 2's `build_review`, when inputs are assembled, then the
  review base is `feat/c1/demo`'s tip, `baseKind` is `child-parent`, and the changed files are only
  those changed since that tip.
- Given a three-child baseline at child 1's `build_review`, when inputs are assembled, then the base is
  resolved exactly as today (merge-base with the default branch).
- Given a three-child baseline at child 2's `build_review`, when a changed child-2 test's `Covers:`
  names task `T1` (child 1), then it resolves against the whole plan.
- Given a two-child baseline in which child 1's `build_review` has open remediation cases, when child 2
  is reviewed, then child 2 sees only cases under `.pipeline/children/2/`.

#### Negative Paths
- Given a three-child baseline at child 2's `build_review`, when `feat/c1/demo` is missing, then input
  assembly fails with `MergeBaseError` naming the missing parent, and no review dispatch occurs.
- Given a two-child baseline after the leaf's FINISH rebase, when the leaf's `build_review` re-runs and
  child 1's tip cannot be translated through the rewrite map, then input assembly fails closed with
  `parent-not-ancestor` rather than grading against the default branch.
- Given a three-child baseline at child 2's `build_review`, when the degraded-fetch check runs, then no
  degraded-fetch warning is emitted for the `child-parent` base.

### Done When
- [ ] `resolveChildBase` returns none, parent tip, `parent-missing` or `parent-not-ancestor`. It is
      consumed by build-review inputs, disposition, full-suite selection, autoheal, task seed,
      amendment claims and acceptance attribution, each with its own fail-closed rule.
- [ ] After the leaf's FINISH rebase, the leaf's parent tip is translated through the persisted
      rewrite map.

## Story 10: The security rubric runs once, at the leaf, over the whole feature

**Requirement:** Scope item 3; ADR decision 9

As a reviewer, I want security graded once over the whole feature, so that no code is security-graded
twice and none is missed.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline with the `security` rubric enabled, at child 1's `build_review`, when
  rubrics are projected, then `testQuality` runs on child 1's diff and `security` is skipped with
  reason `leaf-only`, not `disabled`.
- Given the same baseline at the leaf's `build_review`, when rubrics are projected, then `security`
  grades a whole-feature snapshot based on the default branch, and `testQuality` grades the leaf's
  child diff.

#### Negative Paths
- Given the same baseline at the leaf's `build_review`, when the whole-feature merge-base cannot be
  resolved, then the security projection fails with `MergeBaseError`, and the lap is not recorded as a
  PASS.
- Given a feature with no children and `security` enabled, when `build_review` runs, then exactly one
  snapshot is assembled and security grades it as today.

### Done When
- [ ] Rubric projections can take a per-rubric snapshot. Only the leaf of a stacked feature
      assembles the whole-feature snapshot, for `security`.

## Story 11: Lap caps, stall detection and the repeated-selection guard apply per child

**Requirement:** Scope item 4; ADR decision 10

As an operator, I want every cap to count per child and name the child when it trips, so that one hard
child cannot exhaust the budget of the next, and a halt tells me where to look.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline in which child 1's `build_review` used 4 cumulative kickbacks and then
  passed, when child 2's `build_review` kicks back for the first time, then child 2's ledger records
  cumulative 1, and child 1's ledger still records its own history.
- Given a two-child baseline, when a `build_review` convergence credit is applied to child 2, then the
  credit and its receipt are written to `.pipeline/children/2/kickback-ledger.json` in one lease.
- Given a two-child baseline in which child 1's `build` was selected 5 times and then passed, when
  child 2's `build` is selected, then the repeated-selection count for child 2 starts at 1.

#### Negative Paths
- Given a two-child baseline with child 2 active, when child 2's `build_review` cumulative count
  exceeds 5, then the run halts needs-human, the halt reason names child 2, and child 1's ledger is
  unchanged.
- Given a two-child baseline with child 2 active, when child 2's `build` is selected a seventh time,
  then the run halts needs-human, naming `build` and child 2.
- Given a two-child baseline, when any code path tries to write `growth`, `pendingRepair` or
  `effectiveGrowthCap` into a child ledger, then the write is refused, and plan growth stays recorded
  only in the flat ledger.
- Given a two-child baseline with child 2 active, when `ai-conductor daemon status` shows the kickback
  budget, then it reports child 2's counts, labeled with the child.

### Done When
- [ ] The stuck-gate guard and recovery retries are keyed by step and child.
- [ ] Every kickback-ledger caller passes the active child, and `updateKickbackLedger` accepts a
      child.
- [ ] Cap halts name the child, and child ledgers refuse whole-feature budget fields.

## Story 12: Recovery CLIs act on the active child by default

**Requirement:** Scope item 6; ADR decisions 10–11

As an operator, I want `rewind`, `task` and `kickback-budget` to target the child I am stuck in without
my naming it, and to refuse what needs a restack, so that the runbook recipes still work on a stacked
feature.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline with child 2 active, when `ai-conductor rewind --to build` runs without
  `--child`, then child 2's region is demoted from `build`, and child 1's state is unchanged.
- Given a two-child baseline halted on child 2's `build_review` cumulative cap, when
  `ai-conductor kickback-budget raise --feature demo --gate build_review --by 1 --rationale "..." --child 2` runs, then child 2's cap evidence is
  raised, and the re-kick's resume authorization reads child 2's ledger and resumes.
- Given a two-child baseline with child 2 active, when `ai-conductor kickback-budget reset --feature demo --gate build_review --rationale "..." --child 2`
  runs, then child 2's ledger gate entries are reset, and child 1's and the flat ledger are unchanged.
- Given a two-child baseline with child 2 active, when `ai-conductor task start T3` runs without
  `--child`, then membership is validated against child 2.

#### Negative Paths
- Given a two-child baseline with child 1 closed, when `ai-conductor rewind --to build --child 1` runs,
  then it is refused, naming child 1 as closed and #2943, and no state changes.
- Given a two-child baseline with child 2 active, when `ai-conductor task start T1` runs without `--child`,
  then it is refused, naming `T1` as owned by child 1.
- Given a feature with no children, when each of the three commands runs without `--child`, then its
  output and exit status are exactly today's.

### Done When
- [ ] The three CLIs default `--child` to the active child, and `raise`/`reset` accept `--child`.
- [ ] `rewind` for a closed child is refused, naming #2943.

## Story 13: Halt records stay on the active child and no child branch is pushed

**Requirement:** Scope item 6; ADR decision 11

As an operator, I want a halt during a child to leave a committed record naming the child, without
publishing a branch that is not meant to be public yet.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline with `feat/c1/demo` checked out, when a needs-human halt is written, then
  `.docs/halted/demo.md` is committed on `feat/c1/demo` with a `Child: 1` field, and no push is
  attempted.
- Given a two-child baseline with the leaf active, when a needs-human halt is written, then the record
  is committed on `feat/daemon-demo` with `Child: 2` and pushed as today.

#### Negative Paths
- Given a two-child baseline with `feat/c1/demo` checked out, when a halt is resolved and the record is
  superseded, then the superseding commit stays on `feat/c1/demo` and `publishHaltRecord` refuses to
  push it, naming the child branch.
- Given a two-child baseline with `feat/c1/demo` checked out, when build-failure escalation runs, then
  it refuses, naming the child branch, and opens no PR.
- Given a feature with no children, when a halt is written, then the record and push behave exactly
  as today, with no `Child:` field.

### Done When
- [ ] Halt records written on a child branch carry `Child:` and are never pushed.
- [ ] No push of any `feat/c<k>/<slug>` ref occurs anywhere in the build loop.

## Story 14: Rebases wait for the leaf until restack exists

**Requirement:** Scope item 7; ADR decision 12

As an operator, I want the daemon to leave an in-progress stack on its pinned base until the leaf is
active, so that a re-kick never rewrites earlier children's commits inside a later child.

### Acceptance Criteria

#### Happy Path
- Given a three-child baseline with child 2 active, when a halt is cleared and the re-kick runs, then
  the play-forward rebase is skipped, a `rebase_skipped_for_stack` event naming child 2 is persisted,
  and the run resumes at child 2's next step.
- Given a three-child baseline with child 2 active, when the default branch advances and the
  base-advance sweep re-kicks the feature, then the rebase is skipped the same way.
- Given a two-child baseline with the leaf active, when a re-kick runs, then the leaf alone is rebased
  as today.

#### Negative Paths
- Given a three-child baseline with child 2 active, when the re-kick runs, then neither
  `feat/c1/demo` nor `feat/c2/demo` is rewritten (their SHAs are unchanged).
- Given a feature with no children, when a re-kick runs, then the mandatory play-forward rebase runs
  exactly as today, and no `rebase_skipped_for_stack` event is emitted.

### Done When
- [ ] `resumeRebaseFirst` and the base-advance re-kick consult the cursor and skip, with an event,
      while a non-leaf child is active.

## Story 15: Child transitions are visible on the event spine and in status

**Requirement:** Scope item 8; ADR decision 13

As an operator, I want to see which child a feature is on and when it moved, from the same events
and status surfaces I already use.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline, when it runs to the leaf's `build_review` PASS, then
  `.pipeline/events.jsonl` contains `child_started` (1), `child_closed` (1), `child_switched` (1→2)
  and `child_started` (2), each with the child, position and branch.
- Given a two-child baseline with child 2 active, when a region step starts, then its `step_start`
  and `gate_verdict` events carry `child: 2`.
- Given a two-child baseline with child 2 active, when `ai-conductor daemon status` and the dashboard
  render the feature, then both show `child 2/2`.

#### Negative Paths
- Given a feature with no children, when it runs, then no event carries a `child` key, and no
  `child_*` event is emitted.
- Given a two-child baseline, when a whole-feature step (`manual_test`) starts, then its events carry
  no `child` key.

### Done When
- [ ] The new event variants are declared in the event union and the sinks registry with
      `persist: true`.
- [ ] Region events carry `child` only through a conditional spread, and status and the dashboard
      render the active child.

## Story 16: Slice positions cannot change once children exist

**Requirement:** Scope item 7; ADR decision 13; umbrella D7

As an operator, I want a re-seal that would move, add or remove a slice position after children exist
to stop for me, so that child state is never silently re-attributed.

### Acceptance Criteria

#### Happy Path
- Given a two-child baseline with child 1 closed, when `coverage_binding` re-runs on an existing
  invalidation trigger with unchanged positions, then the envelope is re-sealed and the build
  continues.
- Given a two-child baseline with child 1 closed, when a re-run re-owns story `2` without moving any
  task, then a `story_reowned` event naming the story is emitted.

#### Negative Paths
- Given a two-child baseline with `feat/c1/demo` existing, when a re-seal would add position `3`, then
  `coverage_binding` halts needs-human naming the added position, and the existing envelope is left
  untouched.
- Given a two-child baseline with `.pipeline/children/2/` existing, when a re-seal would remove
  position `2`, then `coverage_binding` halts needs-human naming the removed position.

### Done When
- [ ] The `coverage_binding` runner compares sealed positions against existing child refs, closure
      refs and child directories before any envelope write.

## Story 17: With the flag off, no slices, or one slice, the build loop is unchanged

**Requirement:** Scope items 1 and 9; ADR decisions 2 and 14

As an operator, I want every non-stacked feature to build exactly as it does today, and I want the
`stacked_prs.enabled` key to have a real BUILD consumer.

### Acceptance Criteria

#### Happy Path
- Given #3019's N=1 golden suite, when it runs after this change, then every cell is byte-identical
  to its committed fixtures.
- Given a project with `stacked_prs.enabled: true` and an unsliced plan, when the feature builds,
  then no child branch, closure ref, child directory, `child` event field or hook membership check
  appears.
- Given the config consumer registry, when its drift test runs, then `stacked_prs.enabled` lists the
  BUILD cursor's creation path among its consumers.

#### Negative Paths
- Given a project with `stacked_prs.enabled: true` and an eligible plan with exactly one slice, when it
  builds, then no child is created and the golden output matches its own committed cell. It also matches the unsliced cell, except for the envelope's slice-membership and story-ownership fields.
- Given a project with `stacked_prs.enabled: false` and a sliced plan, when it builds, then no child is
  created and the golden output matches its own committed cell. It also matches the flag-off cell, except for the envelope's slice-membership field.

### Done When
- [ ] The N=1 golden suite gains a flag-on single-slice cell and a flag-on ineligible cell, and all
      cells are byte-identical.
- [ ] The consumer registry records the BUILD consumer of `stacked_prs.enabled`.
