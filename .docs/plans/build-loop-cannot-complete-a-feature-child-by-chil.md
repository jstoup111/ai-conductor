# Implementation Plan: Per-child BUILD region for stacked features (#2942)

**Date:** 2026-10-07
**Design:** .docs/decisions/adr-2026-10-07-per-child-build-region.md
**Stories:** .docs/stories/build-loop-cannot-complete-a-feature-child-by-chil.md
**Conflict check:** Clean as of 2026-10-07 (.docs/conflicts/build-loop-cannot-complete-a-feature-child-by-chil.md)

## Summary

Make the build loop complete a stacked feature child by child. Each child is built in declared
order and validated as an independently green increment. The design is
`adr-2026-10-07-per-child-build-region`: an active-child cursor derived from git, closure refs,
guarded branch lifecycle, per-child region state and gates, per-child caps, a commit-hook
membership check, and halt and rebase guards. Features without children are unchanged. There are
37 tasks.

## Technical Approach

- **Two new modules own the stacked mechanics.** All new helpers live here, never at the top level
  of `conductor.ts`; the conductor decomposition shape guard (#1481) forbids that.
  - `src/conductor/src/engine/child-cursor.ts`: `resolveActiveChild` and `resolveChildBase`.
  - `src/conductor/src/engine/child-lifecycle.ts`: `startChild`, `switchToChild`, `closeChild`
    and `moveLeaf`.
- **The cursor is the only source of the active child.**
  - Positions come from the sealed `coverage_binding` envelope (`readCoverageBindingEnvelope`), and
    closure from `refs/conductor/<slug>/closed/c<k>`.
  - Branch names come from `feature-branch-identity.ts` (`leafBranchFor`, `childBranchFor`).
  - Every consumer receives a `ChildId | undefined` from the cursor result and passes it to the
    #3019 seams: `pipelinePathFor`, `verdictPathFor`, and the child-capable kickback-ledger
    functions. With no child, every seam takes today's flat path.
- **Git writes are compare-and-swap.** Every ref write uses `update-ref <ref> <new> <old>`, with
  `""` as `<old>` for creation. No path uses `stash` or `--autostash`, and no child branch is ever
  pushed.
- **Loop wiring is by symbol.** Task 10 wires region entry and exit into the conductor loop around
  `selectNextGate`, `findResumeIndex` and `resolveRunnableResumeEntry`, plus the loop-tail advance
  that re-enters `acceptance_specs`. The decomposition build may move these out of `conductor.ts`
  first; BUILD finds them by name at its rebased base.
- **Region state is read through one overlay and written through one routed port**
  (`conduct-state-store.ts`). Task 2's static audit lists every reader and writer of flat region
  state. Each later task moves its sites from `pending-child-wiring` to `child-aware`. Task 30
  requires the ledger entries to reach zero.
- **Gate scoping:**
  - **acceptance:** inputs, grounding, attribution, evidence paths and the `prior-child-green`
    exception (Tasks 14–20);
  - **build and stall:** Tasks 21–22;
  - **child base at seven sites:** Tasks 16, 17, 24, 25;
  - **test-suite evidence:** aggregate once at the leaf (Tasks 26–27);
  - **build_review:** remediation cases and the leaf-only security snapshot (Tasks 28–29).
- **Caps** (Tasks 30–31). **Operator surfaces:** CLIs (Tasks 32–33), halt records (Task 34),
  re-kick guard (Task 35), position immutability (Task 36), the flag consumer (Task 37), and status
  and events (Tasks 12–13).
- **Test pattern.** Lifecycle and cursor tests use real temporary git repositories for ref
  semantics. A mocked git or remote runner is used wherever a test must prove that an argument
  (`stash`, `--autostash`, `push`, `fetch`, `ls-remote`, `-n 100`) is never issued. This follows
  the repository's process-isolation rule: assert that refused calls never reach the boundary.
- **Sequencing.** The N=1 golden cells (Task 1) and the drift audit (Task 2) land before any
  production change, and the event variants (Task 3) before any emitter.

## Prerequisites

- #3019 (child identity and storage) and #3039 (story ownership, stack eligibility,
  `stacked_prs.max_slices`) are on main.
- `decompose-conductor-ts-god-class-target-architectu` (#1481 feature 1) may land first. Tasks
  name symbols, not lines.

## Tasks

### Task 1: N=1 golden cells for flag-on single-slice and flag-on ineligible plans
**Story:** 17
**Type:** infrastructure

**Steps:**
1. Write failing tests: extend the #3019 N=1 golden suite (`n1-golden-state.test.ts`, `n1-golden-renderings.test.ts`, `n1-golden-shared.ts`) with two new cells recorded from the pre-change base: `stacked_prs.enabled: true` with an eligible single-slice plan, and `stacked_prs.enabled: true` with an ineligible two-slice plan (no sign-off).
2. Record fixtures from the base commit before any production change (the fixture header names the base sha, as the existing cells do).
3. Verify the new cells pass on the base and stay byte-identical; commit.

**Done when:**
- [test] the `flag-on-ineligible` cell is byte-identical to its own committed fixture recorded at the base (which carries #3039's ineligible refusal).
- [test] the golden suite carries cell `flag-on-single-slice` whose outputs (state files, gate verdict path set, `events.jsonl`, kickback ledger, rewind, kickback-budget, daemon status, dashboard, PR body, shipped-record Cost block) are byte-identical to its own committed fixture and equal the flag-on-unsliced cell output except the envelope's slice-membership and story-ownership fields, and the flag-off-sliced cell output equals the flag-off (unsliced) cell output except the envelope's slice-membership field.
- [test] every existing golden cell (flag off, flag on unsliced, flag off sliced) is still byte-identical to its committed fixture.
- [test] in the `flag-on-single-slice`, flag-on-unsliced and flag-off-sliced cells no `.pipeline/children/` directory, no `refs/conductor/` ref, no `feat/c*/` branch and no event `child` key exist after the run, and the commit-msg hook's membership check abstains.

**Files likely touched:**
- `src/conductor/test/engine/n1-golden-shared.ts` — two new cells
- `src/conductor/test/engine/n1-golden-state.test.ts` — cell assertions
- `src/conductor/test/engine/n1-golden-renderings.test.ts` — cell assertions

**Dependencies:** none

### Task 2: Flat-region drift guard
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write a static audit test `child-region-access-audit.test.ts` that enumerates every production call site of `readAllVerdicts`, `readVerdict`, `writeVerdict`, `readKickbackLedger`, `updateKickbackLedger`, `bumpKickbackGate` and the conduct-state mutation port (`ConductStateStore` mutate/apply-batch methods), and fails when a site is not in an explicit allowlist that records, per site, whether it is child-aware (passes a `child` resolved from the cursor or overlay) or whole-feature-only (with a reason).
2. Seed the allowlist with today's sites, all marked `pending-child-wiring` except the whole-feature-only ones; the test asserts the `pending-child-wiring` set equals a recorded list so later tasks must shrink it.
3. Verify GREEN, commit.

**Done when:**
- [test] `child-region-access-audit.test.ts` fails when a new production call site of any listed reader/writer appears without an allowlist entry, demonstrated with an in-memory source fixture.
- [test] the allowlist classifies every current call site as `child-aware`, `whole-feature-only` (with a reason) or `pending-child-wiring`, and the test pins the `pending-child-wiring` set.

**Files likely touched:**
- `src/conductor/test/engine/child-region-access-audit.test.ts` — new audit test and allowlist

**Dependencies:** none

### Task 3: Child event variants on the spine
**Story:** 15
**Type:** infrastructure

**Steps:**
1. Write failing tests: the `ConductorEvent` union accepts `child_started {child, position, branch}`, `child_closed {child, position, branch, tip}`, `child_switched {from, to, position, branch}`, `rebase_skipped_for_stack {child, reason}` and `story_reowned {story, from, to}`; `EVENT_SINKS` declares each with `persist: true` (the exhaustive `satisfies Record` must fail to compile without them).
2. Implement the variants in `src/conductor/src/types/events.ts` and the rows in `event-sinks.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] an emitter round-trip through `EventPersister` writes each of the five new variants to `events.jsonl` with every declared field, including `position` and `branch` on `child_started`, `child_closed` and `child_switched`.
- [test] `EVENT_SINKS` declares `child_started`, `child_closed`, `child_switched`, `rebase_skipped_for_stack` and `story_reowned` with `persist: true`.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — five variants
- `src/conductor/src/engine/event-sinks.ts` — five rows
- `src/conductor/test/engine/event-sinks.test.ts` — round-trip and declaration tests

**Dependencies:** none

### Task 4: Active-child cursor from closure refs and the sealed envelope
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests for a new `resolveActiveChild(worktree, slug)` in `engine/child-cursor.ts` against real temp git repos: the result is a discriminated union `no-child | active {child, position, isLeaf, branch}` (extended in Task 5); positions come from the sealed `coverage_binding` envelope's slice membership (via `readCoverageBindingEnvelope`); closure is read from `refs/conductor/<slug>/closed/c<k>` via `for-each-ref`; the active child is the lowest non-leaf position with no closure ref, otherwise the leaf, independent of the checked-out branch; the leaf never receives a closure ref.
2. Implement the module; the leaf is the highest position and maps to `leafBranchFor(slug)`, other positions to `childBranchFor(slug, k)`.
3. Verify GREEN, commit.

**Done when:**
- [test] with positions 1,2 and `refs/conductor/demo/closed/c1` present, `resolveActiveChild` returns `active` child 2 with `isLeaf: true` and branch `feat/daemon-demo`, whatever branch is checked out.
- [test] with positions 1,2 and `feat/c1/demo` created at the leaf tip with no commits and no closure ref, `resolveActiveChild` returns `active` child 1, even though the leaf contains child 1's tip.
- [test] a closure ref whose tip equals its parent's tip (an empty child) still counts as closed: with positions 1,2 and such a child 1 the result is `active` child 2, and with every non-leaf position closed the result is the `active` leaf.
- [test] after deleting and re-creating the worktree (closure refs live in the shared `.git`) with a re-sealed envelope, `resolveActiveChild` returns the same active child as before.

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts` — new cursor
- `src/conductor/test/engine/child-cursor.test.ts` — cursor tests

**Dependencies:** none

### Task 5: Cursor fail-closed and no-child rules
**Story:** 1, 4, 17
**Type:** negative-path

**Steps:**
1. Write failing tests extending `child-cursor.test.ts`: the union gains `divergent {child}`, `envelope-missing` and `detached-head`; "no child" is returned only when no `feat/c*/<slug>` ref, no `refs/conductor/<slug>/closed/*` ref and no `.pipeline/children/` directory exist and either `stacked_prs.enabled` is false, the envelope records fewer than two positions, or the envelope carries no `storyOwnership` record.
2. Implement divergence for each closed child: (a) its branch has commits past its closure-ref tip that touch anything other than `.docs/halted/<slug>.md`, or (b) its closure-ref tip — first translated through the persisted rewrite map (`rebase-translate.ts`) when the leaf has been rebased — is not an ancestor of the next non-leaf child's branch (`merge-base --is-ancestor`). When the leaf contains neither the last intermediate child's closure tip nor that tip's rewrite-map image and no leaf rewrite map has been persisted, the result is `active` leaf with `leafMovePending: true`, never `divergent`; once a leaf rewrite map exists, `leafMovePending` is false (an untranslatable tip then surfaces as `parent-not-ancestor` at the child-base sites, Task 24). A failing git invocation returns `git-error` (fail closed, like `detached-head`). Detect detached HEAD via `symbolic-ref -q HEAD`. Children are reported only when the envelope carries a `storyOwnership` record (written only by an eligible `coverage_binding` run, #3039 D6) or child artifacts already exist.
3. Verify GREEN, commit.

**Done when:**
- [test] when a commit is added to `feat/c1/demo` after its closure so its tip is not an ancestor of `feat/c2/demo`, `resolveActiveChild` returns `divergent` naming child 1, and the caller test's halt message contains `restack required (#2943)`.
- [test] with child state present and no sealed envelope, `resolveActiveChild` returns `envelope-missing`, in detached HEAD it returns `detached-head`, and when a git invocation fails (mocked runner) it returns `git-error`; none of these results is `no-child`.
- [test] with `.pipeline/children/1/` present and `stacked_prs.enabled: false`, `resolveActiveChild` returns `active`, never `no-child`.
- [test] `resolveActiveChild` returns `no-child` for `stacked_prs.enabled: true` with one position, for the flag false with a sliced envelope, and for the flag true with two sealed positions but no `storyOwnership` record (an ineligible plan).
- [test] after the leaf is rebased onto a new base with a persisted rewrite map, a commit touching only `.docs/halted/demo.md` on closed `feat/c1/demo` does not make the result `divergent`, and the result is still `active` leaf with `leafMovePending: false`.

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts` — fail-closed results
- `src/conductor/test/engine/child-cursor.test.ts` — negative tests

**Dependencies:** Task 4

### Task 6: Child start — guarded branch creation
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests for `startChild(worktree, slug, child, emitter)` in new `engine/child-lifecycle.ts`: re-check `stacked_prs.max_slices` against the envelope's position count (config loaded with `loadConfig(projectRoot)`), probe `refs/heads/feat/c<k>` (reserved namespace), then create the branch with `update-ref refs/heads/feat/c<k>/<slug> <sha> ""` where `<sha>` is the leaf's current tip for the first position and the previous position's closure-ref tip otherwise; create `.pipeline/children/<k>/`; on the first child creation also write the sealed positions as a blob behind `refs/conductor/<slug>/positions` by compare-and-swap. `startChild` emits no event; `switchToChild` (Task 7) emits `child_started` after the checkout so the persisted order is closed → switched → started.
2. Implement; positions with gaps use the next declared position. For the leaf position `startChild` creates no ref (the leaf already exists and is moved by `moveLeaf`).
3. Verify GREEN, commit.

**Done when:**
- [test] for the leaf position, `startChild` creates no `refs/heads/feat/c*` ref, and no `startChild` call persists any event.
- [test] for the first position, `startChild` creates `feat/c1/demo` at the leaf's tip at that moment (`B`, or `H` after a pre-region halt-record commit on the leaf), creates `.pipeline/children/1/`, and writes `refs/conductor/demo/positions` holding the sealed positions.
- [test] with positions 1, 3 and 5 (position 5 is the leaf), after child 1's closure ref exists, `startChild` for position 3 creates `feat/c3/demo` at child 1's closure tip and no `feat/c2/demo` ref exists.
- [test] with an existing `refs/heads/feat/c1`, `startChild` returns a needs-human refusal naming `refs/heads/feat/c1` and no `feat/c1/demo` ref is created.
- [test] with 3 positions and `stacked_prs.max_slices: 2`, `startChild` returns a needs-human refusal naming `stacked_prs.max_slices` and creates no branch; when `feat/c2/demo` already exists at another sha, the compare-and-swap fails, the refusal names the branch and the existing ref is unchanged.

**Files likely touched:**
- `src/conductor/src/engine/child-lifecycle.ts` — new lifecycle module
- `src/conductor/test/engine/child-lifecycle.test.ts` — start tests

**Dependencies:** Tasks 3, 4

### Task 7: Child switch — clean tree only, no autostash
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests for `switchToChild(worktree, target, emitter)`: refuse when `git status --porcelain` is non-empty, naming every dirty path; otherwise `git switch <branch>` (no `--autostash`, no stash), clear `.pipeline/current-task`, emit `child_switched {from, to, position, branch}` when a previous child exists (no `from` key otherwise), then emit `child_started {child, position, branch}` for the target (branch `feat/daemon-<slug>` for the leaf).
2. Implement in `child-lifecycle.ts`; use a mocked git runner to assert no `stash` or `--autostash` argument is ever issued.
3. Verify GREEN, commit.

**Done when:**
- [test] with an uncommitted change to `src/a.ts`, `switchToChild` returns a refusal naming `src/a.ts`, `git stash list` is unchanged, and the change is still in the worktree.
- [test] on a clean tree `switchToChild` checks out the target branch, `.pipeline/current-task` no longer exists, and `child_switched` (with `from`, `to`, `position`, `branch`) then `child_started` for the target are persisted in that order; on region entry with no previous child only `child_started` (1) is persisted.
- [test] the mocked git runner records no invocation containing `stash` or `--autostash` across both paths.

**Files likely touched:**
- `src/conductor/src/engine/child-lifecycle.ts` — switch
- `src/conductor/test/engine/child-lifecycle.test.ts` — switch tests

**Dependencies:** Task 6

### Task 8: Child close and guarded leaf move
**Story:** 2, 3
**Type:** happy-path

**Steps:**
1. Write failing tests for `closeChild(worktree, slug, child, emitter)` and `moveLeaf(worktree, slug, tip)`: close writes `refs/conductor/<slug>/closed/c<k>` by `update-ref <ref> <tip> ""` and emits `child_closed`; when the next position is the leaf, `moveLeaf` checks `rev-list <leaf> ^<tip> ^origin/<default>` is empty and then runs `update-ref refs/heads/<leaf> <tip> <old>`; otherwise the next child is started by `startChild`.
2. Implement in `child-lifecycle.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] closing child 1 at tip `C1` in a two-child baseline writes `refs/conductor/demo/closed/c1` = `C1`, moves `feat/daemon-demo` from `B` to `C1`, and creates no `feat/c2/demo` ref.
- [test] in a three-child baseline, closing child 1 persists `child_closed` (1) and the subsequent start/switch persists `child_switched` (1→2) and `child_started` (2), in that order.
- [test] when `feat/daemon-demo` carries a commit not reachable from `C1` or `origin/main`, `moveLeaf` returns a needs-human refusal naming the leaf branch and that commit's sha, and the leaf ref is unchanged.
- [test] when the leaf ref is changed between the guard and the `update-ref` (simulated by the mocked runner), the compare-and-swap fails, a needs-human refusal is returned, and the leaf ref keeps the concurrently written value.
- [test] when a pre-region halt-record commit `H` was on the leaf and child 1 was started at `H`, closing child 1 at `C1` moves the leaf to `C1` without refusal.

**Files likely touched:**
- `src/conductor/src/engine/child-lifecycle.ts` — close and leaf move
- `src/conductor/test/engine/child-lifecycle.test.ts` — close/move tests

**Dependencies:** Task 6

### Task 9: Conduct-state overlay and routed region port
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests for `readConductStateOverlay(root, child?)` and a routed mutation port in `conduct-state-store.ts`: with a child, region keys (`CHILD_REGION_STEPS`) are read from and written to `.pipeline/children/<k>/conduct-state.json` and every other key from/to the flat file; with no child both are exactly today's flat behavior. Gate verdict reads for region steps go to `verdictPathFor(dir, step, child)`.
2. Implement; the flat lister `readAllVerdicts` and flat evidence probes stay flat (umbrella D8).
3. Move the port and overlay sites from `pending-child-wiring` to `child-aware` in the Task 2 allowlist; verify GREEN, commit.

**Done when:**
- [test] with child 1's `test_suite` PASS and child 2's FAIL written through the port, `.pipeline/children/1/gates/test_suite.json` records PASS and `.pipeline/children/2/gates/test_suite.json` records FAIL.
- [test] the overlay for child 2 returns child 2's region statuses together with the flat whole-feature statuses, and a region write through the routed port leaves `.pipeline/conduct-state.json` byte-identical.
- [test] `readAllVerdicts` and the flat test-suite evidence probe return the same result with and without a `.pipeline/children/` directory present.

**Files likely touched:**
- `src/conductor/src/engine/conduct-state-store.ts` — overlay and routing
- `src/conductor/src/engine/filesystem-conduct-state-store.ts` — child file adapter
- `src/conductor/test/engine/conduct-state-overlay.test.ts` — overlay tests
- `src/conductor/test/engine/child-region-access-audit.test.ts` — allowlist update

**Dependencies:** Task 2

### Task 10: Loop drives the region per child
**Story:** 1, 2, 3
**Type:** happy-path

**Steps:**
1. Write failing conductor-level tests (mocked dispatcher, real temp git) for two- and three-child baselines: at region entry the loop calls `resolveActiveChild`; on `active` it calls `startChild` only when the child's branch is absent and `switchToChild` only when HEAD differs from the child's branch, before any region dispatch; on `active` leaf with `leafMovePending` it retries `moveLeaf` first; at region exit (all four region steps satisfied for the child) it calls `closeChild` and then `moveLeaf` or `startChild`, switches, and re-enters at `acceptance_specs`; whole-feature steps after `build_review` are selectable only when the active child is the leaf and the leaf's region is satisfied.
2. Implement in the conductor loop at the region entry and the loop-tail advance, naming symbols (`selectNextGate`, the loop-tail advance), and keep new helpers in `child-cursor.ts`/`child-lifecycle.ts` (never at `conductor.ts` top level, per the decomposition shape guard).
3. Verify GREEN, commit.

**Done when:**
- [test] in a two-child run, no dispatch for tasks `T3`/`T4` and no `feat/c2/demo` creation happens before child 1's `build_review` PASS, and child 2's `acceptance_specs` is the first dispatch after child 1 closes.
- [test] after the leaf's `build_review` PASS, the next dispatched step is `manual_test` on `feat/daemon-demo`.
- [test] on region entry HEAD is `feat/c1/demo`; in a three-child run after child 1 closes at `C1`, `refs/conductor/demo/closed/c1` equals `C1`, `feat/c2/demo` equals `C1`, HEAD is `feat/c2/demo` and `.pipeline/current-task` is absent; in a two-child run after the leaf move HEAD is `feat/daemon-demo`.
- [test] when a pre-region halt-record commit `H` is on the leaf, entering the region creates `feat/c1/demo` equal to `H`.
- [test] with positions 1, 3 and 5, after child 1 closes at `C1` the loop creates `feat/c3/demo` at `C1` as the next child, and no `feat/c2/demo` ref is ever created.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — region entry/exit wiring
- `src/conductor/test/engine/stacked-region-loop.test.ts` — loop tests

**Dependencies:** Tasks 5, 7, 8, 9

### Task 10.1: Loop halts needs-human on every cursor and lifecycle refusal
**Story:** 1, 2, 3
**Type:** negative-path

**Steps:**
1. Write failing conductor-level tests: each cursor result `divergent`, `envelope-missing`, `detached-head`, `git-error` and each refusal from `startChild`, `switchToChild` and `moveLeaf` writes a needs-human HALT through the existing halt seam carrying the cause, and no region step is dispatched; a concurrent ref creation is injected between the probe and `update-ref` through a mocked git runner hook.
2. Implement the refusal-to-HALT mapping at region entry and exit.
3. Verify GREEN, commit.

**Done when:**
- [test] when the cursor returns `divergent`, the run writes a needs-human HALT naming child 1 and `restack required (#2943)` and dispatches no region step.
- [test] when the cursor returns `envelope-missing` or `detached-head`, the run writes a needs-human HALT naming the missing envelope or the detached HEAD, dispatches no region step, and the flat region files outside `.pipeline/children/` (`gates/<region step>.json`, region keys of `conduct-state.json`, `kickback-ledger.json` gate entries, test-suite and acceptance evidence files) are byte-identical before and after the halt.
- [test] when `startChild` refuses, the run writes a needs-human HALT naming `refs/heads/feat/c1` (reserved namespace) or `stacked_prs.max_slices` respectively, and no child branch is created.
- [test] when `feat/c2/demo` is created by another process between the probe and the `update-ref`, the compare-and-swap fails, the run writes a needs-human HALT naming `feat/c2/demo`, and that ref keeps the concurrently written value.
- [test] when `moveLeaf` refuses because the leaf has its own commit, or because the leaf ref changed concurrently, the run writes a needs-human HALT naming the leaf branch (and the extra commit's sha in the first case) and the leaf ref is not overwritten by the engine.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — refusal-to-HALT mapping
- `src/conductor/test/engine/stacked-region-halts.test.ts` — halt tests

**Dependencies:** Task 10

### Task 10.2: Selector and resume read the overlay
**Story:** 1, 4
**Type:** happy-path

**Steps:**
1. Write failing tests: `selectNextGate`, `findResumeIndex` and `resolveRunnableResumeEntry` receive the overlay for the active child (`readConductStateOverlay`) instead of the flat state; a three-child worktree recreation re-seals the envelope through `coverage_binding` and resumes in child 3.
2. Implement in `selector.ts`, `resume.ts` and the conductor's resume entry, naming symbols; the resume clamp (`resumeClamp` with `earliestUnsatisfiedGateIndex`/`gateSatisfied`) reads the overlay's region verdicts instead of the flat `readAllVerdicts` result.
3. Update the Task 2 allowlist; verify GREEN, commit.

**Done when:**
- [test] with child 2 active, child 1's `build` satisfied and child 2's `build` pending, and flat `coverage_binding` done, `selectNextGate` returns child 2's `build`, and returns `manual_test` only after child 2's four region steps are satisfied.
- [test] `findResumeIndex`, `resolveRunnableResumeEntry` and the resume clamp over the same overlay resume at child 2's `build` (the clamp does not pull the index back to child 2's `acceptance_specs` when child 2's `acceptance_specs` verdict is a PASS under `.pipeline/children/2/gates/`), reading flat whole-feature status and child 2's region status together.
- [test] with `stacked_prs.enabled: false` and child state present, the selector reads region step status from `.pipeline/children/<active>/conduct-state.json`, not the flat file.
- [test] after child 1 closes, a simulated daemon restart (new `Conductor` over the same worktree) dispatches child 2's `acceptance_specs` first and never dispatches child 1's region steps again.
- [test] in a three-child run with children 1 and 2 closed and child 3 mid-`build`, after the worktree is removed and recreated from the leaf branch, `coverage_binding` re-seals the envelope and the next dispatched region step is child 3's `acceptance_specs` (child 3's gitignored region evidence does not survive recreation).

**Files likely touched:**
- `src/conductor/src/engine/selector.ts` — overlay input
- `src/conductor/src/engine/resume.ts` — overlay input
- `src/conductor/src/engine/conductor.ts` — resume entry overlay
- `src/conductor/test/engine/stacked-selector-resume.test.ts` — tests
- `src/conductor/test/engine/child-region-access-audit.test.ts` — allowlist

**Dependencies:** Task 10

### Task 10.3: Remaining flat readers read the overlay
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: `checkGate`, `auto-resume` (state discovery), `halt-clear-cli` (`last_step` source) and `finish-publication-production` (`observeImplementationEvidence` verdict reads) read region state through `readConductStateOverlay` / child verdict paths for the active child on a feature with children, and read exactly today's flat files on a feature with no children.
2. Implement at each site, naming symbols.
3. Move these sites to `child-aware` in the Task 2 allowlist; verify GREEN, commit.

**Done when:**
- [test] with child 2 active and child 2's `build` done, `checkGate` for `test_suite` passes from the overlay, and `halt-clear` restores `last_step` from child 2's `conduct-state.json`.
- [test] `finish-publication-production` reads the leaf child's `test_suite` and `build_review` verdicts from `.pipeline/children/2/gates/`, and `auto-resume` resolves the feature's resume state from the overlay.
- [test] `child-region-access-audit.test.ts` reports an empty `pending-child-wiring` set.

**Files likely touched:**
- `src/conductor/src/engine/gates.ts` — overlay input
- `src/conductor/src/engine/auto-resume.ts` — overlay read
- `src/conductor/src/engine/halt-clear-cli.ts` — overlay read
- `src/conductor/src/engine/finish-publication-production.ts` — child verdicts
- `src/conductor/test/engine/stacked-flat-readers.test.ts` — tests
- `src/conductor/test/engine/child-region-access-audit.test.ts` — allowlist

**Dependencies:** Tasks 10.2, 11, 13, 26, 27, 28, 30, 32

### Task 11: Whole-feature kickbacks, stale cascades and rebase invalidations land in the active child
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: with child 2 (leaf) active, a `manual_test` kickback to `build`, the positional stale cascade, and a rebase invalidation of `build_review` write through the routed port to child 2; a kickback to `plan` or `coverage_binding` is unchanged; with child state present and `stacked_prs.enabled: false`, region writes still go to the child.
2. Implement by passing the cursor's child into the kickback, stale-cascade and rebase-invalidation writers: `rebase-transition.ts`, the conductor's stale cascade, and the `readVerdict`/`writeVerdict` sites in `rebase.ts` (`applicableOriginalPass`, regrade candidates, invalidation targets, `reverifyOrInvalidateRebaseGate`).
3. Update the Task 2 allowlist; verify GREEN, commit.

**Done when:**
- [test] a `manual_test` kickback to `build` with child 2 active demotes `build` in `.pipeline/children/2/conduct-state.json` and leaves `.pipeline/children/1/` byte-identical.
- [test] a rebase invalidation of `build_review` with child 2 active marks it stale in child 2's state and adds no region key to `.pipeline/conduct-state.json`.
- [test] a kickback targeting `plan` or `coverage_binding` produces the same flat state change as on a feature with no children, and no file under `.pipeline/children/` changes.
- [test] with child state present and `stacked_prs.enabled: false`, a region write lands in the active child and no `.pipeline/gates/<region step>.json` is created or modified.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — kickback and stale cascade child
- `src/conductor/src/engine/rebase-transition.ts` — invalidation child
- `src/conductor/src/engine/rebase.ts` — verdict sites child
- `src/conductor/test/engine/stacked-region-kickbacks.test.ts` — tests

**Dependencies:** Task 10

### Task 12: Region events carry the child
**Story:** 15
**Type:** happy-path

**Steps:**
1. Write failing tests: `step_start`, `gate_verdict`, `kickback` and `loop_halt` for a region step of an active child carry `child` via conditional spread; whole-feature step events and every event of a feature with no children carry no `child` key.
2. Implement at the region emit sites using the cursor's child.
3. Verify GREEN, commit.

**Done when:**
- [test] in a two-child run, `step_start` and `gate_verdict` for child 2's region steps carry `child: 2` in `events.jsonl`, and the `child_*` sequence `child_started` (1), `child_closed` (1), `child_switched` (1→2), `child_started` (2) appears with child, position and branch.
- [test] events for `manual_test` carry no `child` key, and a run with no children emits no `child` key and no `child_*` event.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — region emit sites
- `src/conductor/test/engine/stacked-region-events.test.ts` — event tests

**Dependencies:** Tasks 3, 10

### Task 13: Status and dashboard show the active child
**Story:** 15, 11
**Type:** happy-path

**Steps:**
1. Write failing tests: `ai-conductor daemon status` and the dashboard render `child k/N` for a stacked feature, read region state through the overlay, and the kickback-budget view in daemon status reads and labels the active child's ledger.
2. Implement in `daemon-dashboard.ts`, `daemon-observe-cli.ts` and `kickback-budget-view.ts` using `resolveActiveChild`.
3. Update the Task 2 allowlist; verify GREEN, commit.

**Done when:**
- [test] with child 2 active, the daemon status line and the dashboard row for `demo` both contain `child 2/2`, child 2's region step status and the flat whole-feature step status (for example `coverage_binding` done).
- [test] with child 2 active, the daemon status budget view prints child 2's `build_review` counts under a `Child: 2` label.
- [test] for a feature with no children the status and dashboard output equals the committed N=1 golden rendering.

**Files likely touched:**
- `src/conductor/src/engine/daemon-dashboard.ts` — child column
- `src/conductor/src/engine/daemon-observe-cli.ts` — status and budget view
- `src/conductor/src/engine/kickback-budget-view.ts` — child label
- `src/conductor/test/engine/stacked-status.test.ts` — tests

**Dependencies:** Tasks 9, 10

### Task 14: Acceptance inputs and evidence paths per child
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: the `acceptance_specs` dispatch for an active child supplies only that child's owned stories (from `projectChildOwnership` over the envelope's `storyOwnership`); the completion predicate, `acceptance-red-runner.ts` self-heal and run-contract reads/writes use `pipelinePathFor(root, 'acceptance-specs-red.json', child)` and the run-contract equivalent; no child keeps today's root paths.
2. Implement in `artifacts.ts` (acceptance predicate), `acceptance-red-runner.ts` and the acceptance dispatch input builder in `step-runners.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] the child-1 `acceptance_specs` dispatch input names story `1`'s criteria and no story `2` criterion.
- [test] the self-heal runner for child 1 writes `.pipeline/children/1/acceptance-specs-red.json` and the run contract under `.pipeline/children/1/`, and the predicate reads only that path.
- [test] for a feature with no children the predicate reads only `.pipeline/acceptance-specs-red.json`, as the existing pinned test asserts.
- [test] after child 2's acceptance completes, child 1's `acceptance_specs` verdict file is byte-identical to before.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — child evidence paths
- `src/conductor/src/engine/acceptance-red-runner.ts` — child paths
- `src/conductor/src/engine/step-runners.ts` — child-scoped input
- `src/conductor/test/engine/acceptance-child-scope.test.ts` — tests

**Dependencies:** Task 10

### Task 15: Disposition grounding covers exactly the child's criteria
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: `groundDispositionOnlyEvidence` for an active child projects `extractAuthoritativeStoryCriteria` to the child's owned stories; an omitted owned criterion and a listed foreign-story criterion each refuse.
2. Implement the projection in `artifacts.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] at child 2 with every story-2 criterion disposed and no spec files changed since child 1's tip, disposition-only completion passes.
- [test] at child 2 a disposition record missing one story-2 criterion fails, naming that criterion id as omitted.
- [test] at child 2 a disposition record listing a story-1 criterion fails, naming that criterion as not owned by child 2.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — grounding projection
- `src/conductor/test/engine/acceptance-child-scope.test.ts` — grounding tests

**Dependencies:** Task 14

### Task 16: Child base producer
**Story:** 9
**Type:** infrastructure

**Steps:**
1. Write failing tests for `resolveChildBase(worktree, slug, child)` in `child-cursor.ts`: `none` for no child or the first position; `parent {sha}` = the previous position's closure-ref tip (local only, no fetch, no `ls-remote`); `parent-missing` when the previous position has no closure ref or its branch is absent; `parent-not-ancestor` when the parent tip is not an ancestor of HEAD; after the leaf's FINISH rebase, the parent tip is translated through the persisted rewrite map (`rebase-translate.ts`) and `parent-not-ancestor` is returned when it cannot be translated.
2. Implement.
3. Verify GREEN, commit.

**Done when:**
- [test] `resolveChildBase` returns `none` for no child and for position 1, and `parent` with child 1's closure-ref tip (equal to `feat/c1/demo`'s tip) for position 2, a halt-record commit on `feat/c1/demo` past its closure tip leaving the result unchanged, with the mocked runner recording no `fetch` or `ls-remote`.
- [test] it returns `parent-missing` when `feat/c1/demo` is absent and `parent-not-ancestor` when the tip is not an ancestor of HEAD.
- [test] after a leaf rebase that persisted a rewrite map containing child 1's tip, it returns `parent` with the translated sha; with no mapping entry it returns `parent-not-ancestor`.

**Files likely touched:**
- `src/conductor/src/engine/child-cursor.ts` — base producer
- `src/conductor/test/engine/child-base.test.ts` — tests

**Dependencies:** Task 4

### Task 17: Acceptance spec attribution uses the child base
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: the disposition-only spec-file attribution in `artifacts.ts` computes changed paths since `resolveChildBase` when it returns `parent`; earlier children's spec files are not attributed; `parent-missing` or `parent-not-ancestor` refuses disposition-only naming the parent.
2. Implement as the seventh base site.
3. Verify GREEN, commit.

**Done when:**
- [test] at child 2 with spec files committed by child 1, disposition-only completion is not refused for those files.
- [test] at child 2 with `feat/c1/demo` missing, disposition-only completion is refused with a reason naming the missing parent branch.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — attribution base
- `src/conductor/test/engine/acceptance-child-scope.test.ts` — attribution tests

**Dependencies:** Tasks 15, 16

### Task 18: No-owned-criteria outcome
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: when the active child owns no story, `acceptance_specs` completes without dispatching the skill with typed outcome `no-owned-criteria` recorded in the child's verdict, and the region proceeds to `build`.
2. Implement in the acceptance completion path and verdict writer.
3. Verify GREEN, commit.

**Done when:**
- [test] for a child owning no story, the child's `acceptance_specs` verdict records outcome `no-owned-criteria`, no `writing-system-tests` dispatch occurs, and the next dispatched step is that child's `build`.
- [test] a feature with no children never produces `no-owned-criteria`.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — outcome
- `src/conductor/src/engine/conductor.ts` — skip dispatch for the outcome
- `src/conductor/test/engine/acceptance-child-scope.test.ts` — tests

**Dependencies:** Task 14

### Task 19: `prior-child-green` recorded-RED exception
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests for `validateAcceptanceRedEvidence`: a marker with `failed: 0` and an exception of kind `prior-child-green` whose attribution equals the parent child's closure-ref tip is accepted (other execution requirements still apply); the same kind with any other attribution is refused naming the attribution; `failed: 0` with no exception still fails.
2. Implement the kind and its attribution check (closure ref read through `child-cursor.ts`).
3. Verify GREEN, commit.

**Done when:**
- [test] at child 2, a marker with `failed: 0` and a `prior-child-green` exception attributed to `refs/conductor/demo/closed/c1`'s tip is accepted and the `acceptance_red` event carries `viaException: true`.
- [test] the same exception attributed to any other sha is refused with a reason naming that attribution, and `failed: 0` without an exception is refused as today.
- [test] the self-heal re-run for child 2 reads the existing `prior-child-green` exception from `.pipeline/children/2/acceptance-specs-red.json` and carries it forward unchanged into the fresh marker at the same path.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — exception kind
- `src/conductor/src/engine/acceptance-red-runner.ts` — carry exception at child path
- `src/conductor/test/engine/acceptance-red-exception.test.ts` — tests

**Dependencies:** Tasks 4, 14

### Task 20: writing-system-tests skill writes child-scoped specs and evidence
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write a failing skill-contract test that reads `skills/writing-system-tests/SKILL.md` and asserts it instructs: in a stacked feature, cover only the supplied owned stories; write the RED marker and run contract at the supplied child path; record a `prior-child-green` exception attributed to the supplied parent closure tip when an owned spec already passes.
2. Update the skill text accordingly.
3. Verify GREEN, commit.

**Done when:**
- [test] the skill-contract test finds the owned-stories rule, the `.pipeline/children/<k>/acceptance-specs-red.json` path rule and the `prior-child-green` attribution rule in `skills/writing-system-tests/SKILL.md`.
- [test] the skill text for features with no children still names `.pipeline/acceptance-specs-red.json` unchanged.

**Files likely touched:**
- `skills/writing-system-tests/SKILL.md` — child rules
- `src/conductor/test/skills/writing-system-tests-contract.test.ts` — contract test

**Dependencies:** Tasks 14, 19

### Task 21: Remediation tasks record their child
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests: `recordAppendedRemediationTaskIds` gains an optional child and records `appendedRemediationTaskChildren: {<id>: <child>}` in `.pipeline/engine-state.json` beside `appendedRemediationTaskIds`; the conductor's remediation append passes the active child; with no child nothing new is written.
2. Implement.
3. Verify GREEN, commit.

**Done when:**
- [test] appending `rem-1` while child 2 is active records `appendedRemediationTaskChildren["rem-1"] = 2` and `rem-1` in `appendedRemediationTaskIds`.
- [test] appending with no child writes `engine-state.json` byte-identical to today's shape (no `appendedRemediationTaskChildren` key).

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — record child
- `src/conductor/src/engine/conductor.ts` — pass active child at append
- `src/conductor/test/engine/remediation-task-child.test.ts` — tests

**Dependencies:** Task 10

### Task 22: Build completion and stall detection fold over the child's tasks
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: the build predicate's task set for an active child is that child's slice membership plus remediation tasks recorded to it; `countResolvedTasks` used by the stall breaker counts the same set; the commit-movement floor (HEAD unmoved) still applies; a remediation id with no recorded child fails closed.
2. Implement in `artifacts.ts` (build predicate) and `task-progress.ts`/the conductor stall check.
3. Verify GREEN, commit.

**Done when:**
- [test] at child 1 with `T1`,`T2` resolved and `T3`,`T4` pending, `build` completes; with `T2` unresolved it fails naming `T2` only (no `T3` or `T4` in the reason).
- [test] at child 2, a dispatch resolving no child-2 task with HEAD unmoved is classified `no_task_progress` although child 1's tasks are resolved; with HEAD moved it is not.
- [test] `rem-1` recorded to child 2 is part of child 2's task set, and a remediation id with no recorded child fails child 2's completion naming the id.
- [test] when repeated `no_task_progress` at child 2 trips the existing stall halt, the halt reason names child 2.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — child task set
- `src/conductor/src/engine/task-progress.ts` — child count
- `src/conductor/src/engine/conductor.ts` — stall check child
- `src/conductor/test/engine/build-child-scope.test.ts` — tests

**Dependencies:** Task 21

### Task 23: Commit hook membership check
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests for a new hook-only command `ai-conductor task-membership-check <commit-message-file>` (new `task-membership-check-cli.ts`, recognized like `scope-check-cli.ts`): read `git symbolic-ref`, parse with `parseFeatureBranch`; on a child branch, refuse (exit 1) a `Task:` id not in that child's membership (envelope projection plus `appendedRemediationTaskChildren`), naming the task, its owning child and the checked-out child; refuse when membership is unreadable; abstain (exit 0) on non-child branches. Wire it into the commit-msg hook asset in `git-hook-assets.ts` after trailer extraction and before the existing scope-check call; `CONDUCT_ENGINE_COMMIT` bypasses it as it bypasses the existing checks.
2. Implement and register the command in `cli.ts` dispatch.
3. Verify GREEN with a real temp repo using the installed hooks, commit.

**Done when:**
- [test] on `feat/c1/demo`, a commit with `Task: T1` succeeds and a commit with `Task: T3` is rejected with a message naming `T3`, child 2 and child 1, and `git rev-list --count HEAD` is unchanged.
- [test] on `feat/c1/demo` with `.pipeline/current-task` holding `T3`, the stamped commit is rejected the same way; with the envelope missing the commit is rejected naming the unreadable membership.
- [test] on `feat/daemon-other` (no children) the hook output and exit status for a valid task id are identical to today, and with `CONDUCT_ENGINE_COMMIT` set a cross-child commit succeeds.

**Files likely touched:**
- `src/conductor/src/engine/task-membership-check-cli.ts` — new command
- `src/conductor/src/engine/git-hook-assets.ts` — hook call
- `src/conductor/src/cli.ts` — dispatch
- `src/conductor/test/engine/task-membership-hook.test.ts` — tests

**Dependencies:** Task 21

### Task 24: Build-review inputs and disposition consume the child base
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests: `assembleBuildReviewInputs` and `build-review-disposition` call `resolveChildBase` before their existing ladder; `parent` sets the review base to the parent tip with `baseKind: 'child-parent'` and suppresses the degraded-fetch warning; `none` keeps today's ladder; `parent-missing`/`parent-not-ancestor` throw `MergeBaseError` naming the parent; the plan body stays whole.
2. Implement.
3. Verify GREEN, commit.

**Done when:**
- [test] at child 2 of a three-child baseline, inputs carry base = `feat/c1/demo` tip, `baseKind: 'child-parent'`, changed files limited to those since that tip, and no degraded-fetch warning.
- [test] at child 1 the inputs equal those computed for a feature with no children (merge-base with the default branch).
- [test] at child 2 a changed test whose `Covers:` names `T1` resolves against the whole plan, and with `feat/c1/demo` missing assembly throws `MergeBaseError` naming the parent with no review dispatch.
- [test] after the leaf's FINISH rebase with an untranslatable parent tip, assembly throws `MergeBaseError` with `parent-not-ancestor`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — child base
- `src/conductor/src/engine/build-review-disposition.ts` — child base
- `src/conductor/test/engine/build-review-child-base.test.ts` — tests

**Dependencies:** Task 16

### Task 25: Full-suite selection, autoheal, task seed and amendment claims consume the child base
**Story:** 8, 9
**Type:** negative-path

**Steps:**
1. Write failing tests at each site: full-suite changed selection uses the parent tip, and on `parent-missing`/`parent-not-ancestor` runs the aggregate suite; autoheal returns no commits instead of widening to `-n 100 HEAD`; task seed proves nothing; coverage-binding amendment claims treat all obligations as claimed.
2. Implement at each site, keeping each site's existing policy for `none`.
3. Verify GREEN, commit.

**Done when:**
- [test] at child 2 with `feat/c1/demo` missing, full-suite selection runs the aggregate suite, and with the parent present the scoped selection covers only files changed since `feat/c1/demo`'s tip.
- [test] with `parent-missing`, autoheal returns zero commits (no `-n 100` invocation recorded by the mocked runner), task seed marks no task proven, and amendment claims include every obligation.

**Files likely touched:**
- `src/conductor/src/engine/full-suite-verifier.ts` — selection base
- `src/conductor/src/engine/autoheal.ts` — window base
- `src/conductor/src/engine/task-seed.ts` — seed base
- `src/conductor/src/engine/step-runners.ts` — amendment claims base
- `src/conductor/test/engine/child-base-sites.test.ts` — tests

**Dependencies:** Task 16

### Task 26: Test-suite evidence per child; aggregate once at the leaf
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing tests: `FullSuiteVerifier` takes the active child and reads/writes `pipelinePathFor(root, FULL_SUITE_EVIDENCE_PATH, child)`; under `full_suite: once` a non-leaf child requires no aggregate, the leaf requires one aggregate PASS recorded in the leaf's evidence, and an earlier child's aggregate PASS never satisfies the leaf.
2. Implement in `full-suite-verifier.ts`/`full-suite-evidence.ts` and the `test_suite` runner.
3. Update the Task 2 allowlist; verify GREEN, commit.

**Done when:**
- [test] at child 1 under `full_suite: once`, a passing scoped run writes `.pipeline/children/1/test-suite-evidence.json` with child 1's base and no aggregate run is required.
- [test] at the leaf under `full_suite: once`, `test_suite` requires and records an aggregate PASS in the leaf's evidence, and child 1's recorded aggregate PASS does not satisfy that requirement.

**Files likely touched:**
- `src/conductor/src/engine/full-suite-verifier.ts` — child evidence and leaf aggregate
- `src/conductor/src/engine/full-suite-evidence.ts` — child path
- `src/conductor/test/engine/full-suite-child.test.ts` — tests

**Dependencies:** Tasks 10, 16

### Task 27: FINISH fence, complete-verifier and build-review verifier read the leaf child
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing tests: the FINISH validation fence re-verifies `test_suite` through the leaf child's evidence and writes its verdict to the leaf child; `complete-verifier` accepts the leaf child's evidence and status; `assembleBuildReviewInputs` builds its `FullSuiteVerifier` with the active child; with no aggregate PASS in the leaf evidence the fence fails and no flat `.pipeline/test-suite-evidence.json` is written.
2. Implement.
3. Verify GREEN, commit.

**Done when:**
- [test] at the FINISH fence of a two-child feature, the fence reads and writes `.pipeline/children/2/` evidence and verdict and `complete-verifier` returns complete from the leaf child's evidence.
- [test] when the leaf evidence lacks an aggregate PASS, the fence fails as today and `.pipeline/test-suite-evidence.json` does not exist afterwards.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — FINISH fence child
- `src/conductor/src/engine/complete-verifier.ts` — child evidence
- `src/conductor/src/engine/build-review-inputs.ts` — verifier child
- `src/conductor/test/engine/finish-fence-child.test.ts` — tests

**Dependencies:** Task 26

### Task 28: Build-review remediation cases per child
**Story:** 9
**Type:** happy-path

**Steps:**
1. Write failing tests: `remediation-case-store.ts` reads and writes cases under `pipelinePathFor(root, <cases path>, child)` for an active child; child 2's review sees only child 2's cases while child 1's remain on disk.
2. Implement and pass the active child from the build-review runner.
3. Update the Task 2 allowlist; verify GREEN, commit.

**Done when:**
- [test] with open cases under `.pipeline/children/1/`, child 2's `build_review` loads zero cases and writes new ones under `.pipeline/children/2/`, leaving child 1's files byte-identical.
- [test] with no children the case store path is today's flat path.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-store.ts` — child path
- `src/conductor/src/engine/step-runners.ts` — pass child
- `src/conductor/test/engine/remediation-case-child.test.ts` — tests

**Dependencies:** Task 10

### Task 29: Security rubric at the leaf over a whole-feature snapshot
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing tests: `deriveBuildReviewRubricProjections` accepts a snapshot per rubric; on a non-leaf child `security` is skipped with reason `leaf-only` and `testQuality` grades the child-base snapshot; on the leaf, a second snapshot based on the default-branch merge-base is assembled for `security` only; a whole-feature `MergeBaseError` fails the projection without recording a PASS; with no children exactly one snapshot is assembled.
2. Implement in `build-review-projections.ts` and `build-review-inputs.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] at child 1 with `security` enabled, `testQuality` is dispatched on child 1's diff and `security` is reported skipped with reason `leaf-only` (not `disabled`).
- [test] at the leaf, `security` grades a snapshot whose merge-base is the default-branch merge-base and `testQuality` grades the leaf's child-base snapshot.
- [test] at the leaf with an unresolvable whole-feature merge-base, the security projection fails with `MergeBaseError` and no PASS verdict is written; a feature with no children assembles exactly one snapshot for both rubrics.

**Files likely touched:**
- `src/conductor/src/engine/build-review-projections.ts` — per-rubric snapshot
- `src/conductor/src/engine/build-review-inputs.ts` — leaf whole-feature snapshot
- `src/conductor/test/engine/build-review-security-leaf.test.ts` — tests

**Dependencies:** Task 24

### Task 30: Kickback ledger is per child for every caller
**Story:** 11
**Type:** happy-path

**Steps:**
1. Write failing tests: `updateKickbackLedger` gains `child?`; every caller in `conductor.ts`, `build-review-cli.ts`, `rebase-transition.ts`, `daemon-rekick.ts`, `daemon-observe-cli.ts`, `kickback-budget-cli.ts` (its existing `inspect`/`raise`/`reset` ledger reads and writes; the `--child` flag itself is Task 33), `step-runners.ts` (mechanical-fault bump) and `remediation-case-effects.ts` passes the cursor's child; a convergence credit and its receipt are written in the child's ledger within one lease; a child ledger refuses `growth`, `pendingRepair` and `effectiveGrowthCap`.
2. Implement; move the ledger sites to `child-aware` in the Task 2 allowlist (the `pending-child-wiring` ledger entries must reach zero).
3. Verify GREEN, commit.

**Done when:**
- [test] after child 1's `build_review` used 4 cumulative kickbacks and passed, child 2's first kickback records cumulative 1 in `.pipeline/children/2/kickback-ledger.json` and child 1's ledger is unchanged.
- [test] a `build_review` convergence credit for child 2 writes the credit and its receipt to child 2's ledger in one lease (a lease-conflict test shows neither is written alone).
- [test] writing `growth`, `pendingRepair` or `effectiveGrowthCap` into a child ledger is refused and plan growth stays only in `.pipeline/kickback-ledger.json`.
- [test] `child-region-access-audit.test.ts` reports no ledger call site in `pending-child-wiring`.
- [test] a `build_review` mechanical-fault bump while child 2 is active increments the mechanical counter on child 2's ledger entry and leaves child 1's and the flat ledger unchanged.

**Files likely touched:**
- `src/conductor/src/engine/kickback-ledger.ts` — child parameter and refusals
- `src/conductor/src/engine/conductor.ts` — callers
- `src/conductor/src/engine/build-review-cli.ts` — callers
- `src/conductor/src/engine/rebase-transition.ts` — callers
- `src/conductor/src/engine/step-runners.ts` — mechanical-fault caller
- `src/conductor/src/engine/remediation-case-effects.ts` — caller
- `src/conductor/src/engine/kickback-budget-cli.ts` — callers
- `src/conductor/test/engine/kickback-ledger-child.test.ts` — tests
- `src/conductor/test/engine/child-region-access-audit.test.ts` — allowlist

**Dependencies:** Tasks 10, 11

### Task 31: Repeated-selection guard, recovery retries and cap halts per child
**Story:** 11
**Type:** negative-path

**Steps:**
1. Write failing tests: the stuck-gate map and `recoveryRetries` are keyed by `(step, child)`; the per-gate kickback cap HALT and the mechanical-fault exhaustion HALT name the child; child 2's `build_review` cumulative count exceeding 5 halts needs-human naming child 2 and leaves child 1's ledger unchanged; child 2's `build` selected a seventh time halts naming `build` and child 2; a fresh child's selection count starts at 1; `RECOVERABLE_CAP_HALT_CLASS_BY_GATE` still classifies the per-child cap halt.
2. Implement.
3. Verify GREEN, commit.

**Done when:**
- [test] after child 1's `build` was selected 5 times and passed, child 2's first `build` selection is counted as 1, and child 2's seventh selection writes a needs-human HALT naming `build` and child 2.
- [test] child 2's sixth cumulative `build_review` kickback writes a needs-human HALT naming child 2, its halt class is the recoverable cap class, and child 1's ledger file is byte-identical.
- [test] exceeding the per-gate kickback cap (`MAX_KICKBACKS_PER_GATE`) for a gate at child 2 writes a needs-human HALT naming the gate, the reason and child 2.
- [test] exhausting the `build_review` mechanical-fault allowance at child 2 writes the existing needs-human exhaustion HALT naming child 2.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — keyed maps and halt text
- `src/conductor/test/engine/stacked-caps.test.ts` — tests

**Dependencies:** Task 30

### Task 32: Recovery CLIs default to the active child; closed-child rewind refused
**Story:** 12
**Type:** happy-path

**Steps:**
1. Write failing tests: without `--child`, `ai-conductor rewind`, `ai-conductor task` and `ai-conductor kickback-budget inspect` resolve the active child through `resolveActiveChild` on a feature with children and behave exactly as today on a feature with no children; `rewind --child k` for a closed child is refused naming child k and #2943 with no state change; `task start T1` with child 2 active is refused naming `T1` as owned by child 1.
2. Implement in `rewind.ts`, `task-cli.ts` and `kickback-budget-cli.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] with child 2 active, `ai-conductor rewind --to build` demotes child 2's region from `build` and leaves `.pipeline/children/1/` byte-identical; `ai-conductor rewind --to coverage_binding` likewise leaves closed child 1's state byte-identical.
- [test] `ai-conductor rewind --to build --child 1` with child 1 closed exits non-zero naming child 1 as closed and `#2943`, and no `.pipeline` file changes.
- [test] with child 2 active, `ai-conductor task start T3` succeeds and `ai-conductor task start T1` is refused naming `T1` and child 1.
- [test] on a feature with no children, each of the three commands without `--child` produces output and exit status identical to the committed N=1 golden rendering.

**Files likely touched:**
- `src/conductor/src/engine/rewind.ts` — default and refusal
- `src/conductor/src/engine/task-cli.ts` — default
- `src/conductor/src/engine/kickback-budget-cli.ts` — default
- `src/conductor/test/engine/recovery-cli-child-default.test.ts` — tests

**Dependencies:** Task 10

### Task 33: `kickback-budget raise|reset --child` and child resume authorization
**Story:** 12
**Type:** happy-path

**Steps:**
1. Write failing tests: `raise` and `reset` accept `--child k` (and default to the active child); they act only on `.pipeline/children/k/kickback-ledger.json`; `--child` for a child with no state is refused naming it; `daemon-rekick.ts`'s resume authorization reads the halted child's ledger so a `raise --child 2` resumes the feature.
2. Implement in `kickback-budget-cli.ts` and `daemon-rekick.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] with child 2 halted on its cumulative cap, `ai-conductor kickback-budget raise --feature demo --gate build_review --by 1 --rationale x --child 2` raises child 2's cap evidence, and the re-kick resume authorization, read from `.pipeline/children/2/kickback-ledger.json`, resumes the feature.
- [test] `ai-conductor kickback-budget reset --feature demo --gate build_review --rationale x --child 2` resets child 2's gate entries and leaves child 1's and the flat ledger byte-identical; `--child 3` without child state is refused naming child 3.

**Files likely touched:**
- `src/conductor/src/engine/kickback-budget-cli.ts` — raise/reset child
- `src/conductor/src/engine/daemon-rekick.ts` — child authorization
- `src/conductor/test/engine/kickback-budget-child.test.ts` — tests

**Dependencies:** Task 30

### Task 34: Halt records on a child branch carry `Child:` and are never pushed
**Story:** 13
**Type:** negative-path

**Steps:**
1. Write failing tests with a mocked remote runner: `recordHalt` and `supersedeHaltRecord` on `feat/c1/demo` commit `.docs/halted/demo.md` with a `Child: 1` field and never call `publishHaltRecord`'s push; `publishHaltRecord` refuses a `feat/c<k>/` branch naming it; on the leaf with children the record carries `Child: <leaf position>` and is pushed as today; `escalateBuildFailure` refuses a child HEAD naming the branch and opens no PR; no children → today's record with no `Child:` field.
2. Implement in `halt-record.ts`, `halt-marker.ts` and `build-failure-escalation.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] a needs-human halt on `feat/c1/demo` commits a record containing `Child: 1` on `feat/c1/demo`, and the mocked remote runner records no push; the superseding commit stays on `feat/c1/demo` and `publishHaltRecord` returns a refusal naming the child branch.
- [test] a halt on `feat/daemon-demo` while child 2 is active commits a record containing `Child: 2` and pushes `HEAD:refs/heads/feat/daemon-demo`.
- [test] `escalateBuildFailure` on `feat/c1/demo` returns a refusal naming the branch and the mocked `gh` records no PR creation; a halt on a feature with no children produces today's record (no `Child:` line) and push.

**Files likely touched:**
- `src/conductor/src/engine/halt-record.ts` — child field and push guard
- `src/conductor/src/engine/halt-marker.ts` — child input
- `src/conductor/src/engine/build-failure-escalation.ts` — child refusal
- `src/conductor/test/engine/halt-record-child.test.ts` — tests

**Dependencies:** Task 4

### Task 35: Re-kick and base-advance rebase skipped while a non-leaf child is active
**Story:** 14
**Type:** negative-path

**Steps:**
1. Write failing tests: `resumeRebaseFirst` and the base-advance re-kick consult `resolveActiveChild`; when the active child is not the leaf they skip the rebase, persist `rebase_skipped_for_stack` naming the child, leave every child branch SHA unchanged and resume at the child's next step; at the leaf they rebase the leaf only; with no children they behave exactly as today with no new event.
2. Implement in `daemon-rekick.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] with child 2 of three active, clearing a halt runs the re-kick without any `rebase` invocation, persists `rebase_skipped_for_stack` with `child: 2`, `feat/c1/demo` and `feat/c2/demo` keep their SHAs, and the next dispatched step is child 2's next region step.
- [test] a default-branch advance re-kick with child 2 active skips the rebase the same way, and with the leaf active the leaf alone is rebased and the next dispatch proceeds without invoking `moveLeaf`.
- [test] on a feature with no children the play-forward rebase runs as today and no `rebase_skipped_for_stack` event is emitted.

**Files likely touched:**
- `src/conductor/src/engine/daemon-rekick.ts` — stack guard
- `src/conductor/test/engine/rekick-stack-guard.test.ts` — tests

**Dependencies:** Tasks 3, 4

### Task 36: Position-immutability guard and story re-own event in coverage_binding
**Story:** 16
**Type:** negative-path

**Steps:**
1. Write failing tests for the `coverage_binding` runner in `step-runners.ts`: before any envelope write, when any `feat/c*/<slug>` ref, closure ref or `.pipeline/children/` entry exists, compare the new slice positions with those recorded behind `refs/conductor/<slug>/positions` (which survives worktree recreation); an added or removed position halts needs-human naming it and leaves the envelope untouched; unchanged positions re-seal; a re-own of a story without a task move emits `story_reowned`.
2. Implement.
3. Verify GREEN, commit.

**Done when:**
- [test] with `feat/c1/demo` existing, a re-seal adding position 3 ends needs-human naming position 3 and the envelope file is byte-identical; with `.pipeline/children/2/` existing, removing position 2 ends needs-human naming position 2.
- [test] with child 1 closed and positions unchanged, a re-run re-seals and the run continues; a re-own of story `2` without a task move persists `story_reowned` naming story `2`.

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — guard
- `src/conductor/test/engine/coverage-binding-position-guard.test.ts` — tests

**Dependencies:** Tasks 3, 4

### Task 37: `stacked_prs.enabled` BUILD consumer registered
**Story:** 17
**Type:** infrastructure

**Steps:**
1. Write a failing registry test: the config consumer registry row for `stacked_prs.enabled` lists the BUILD child cursor (`child-cursor.ts`) among its consumers, and the drift test resolves that the module reads the key.
2. Update `config-consumer-registry.ts`.
3. Verify GREEN, commit.

**Done when:**
- [test] the config consumer registry drift test passes with `stacked_prs.enabled` listing `child-cursor.ts` as a consumer and fails if `child-cursor.ts` stops reading the key.
- [test] the `stacked_prs.enabled` row still lists the land and `coverage_binding` consumers recorded by #3039.

**Files likely touched:**
- `src/conductor/test/engine/config-consumer-registry.ts` — row

**Dependencies:** Task 5

## Task Dependency Graph

```
1, 2, 3, 4 (independent foundations)
4 → 5 → 10 ; 4 → 16 ; 4 → 34 ; 3,4 → 6 → 7, 8 ; 3,4 → 35 ; 3,4 → 36 ; 5 → 37
2 → 9 → 10 ; 5, 7, 8 → 10 → 10.1 ; 10 → 10.2 ;10.2, 11, 13, 26, 27, 28, 30, 32 → 10.3
10 → 11 → 30 → 31 ; 30 → 33
10 → 12 (with 3) ; 9,10 → 13 ; 10 → 14 → 15 → 17 (with 16) ; 14 → 18 ; 4,14 → 19 → 20
10 → 21 → 22 ; 21 → 23
16 → 24 → 29 ; 16 → 25 ; 10,16 → 26 → 27 ; 10 → 28 ; 10 → 32
```

## Integration Points

- **After Task 10.1:** a two- or three-child feature runs its region in declared order through the
  real conductor loop. It closes children, moves the leaf, and halts needs-human on every cursor or
  lifecycle refusal.
- **After Task 23:** the installed commit-msg hook enforces child membership in a real worktree.
- **After Task 27:** the FINISH fence and complete-verifier accept a stacked feature's leaf
  evidence, so a stacked feature can reach SHIP.
- **After Task 35:** daemon re-kicks no longer rewrite an in-progress stack.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a two-child baseline in which child 1's region has passed and `refs/conductor/demo/closed/c1` exists, when the daemon restarts and resumes the feature, then the next dispatched step is child 2's `acceptance_specs` and child 1's region steps are not dispatched again. | 10.2 | "dispatches child 2's `acceptance_specs` first and never dispatches child 1's region steps again" | diff-local |
| Story 1 happy: Given a three-child baseline in which children 1 and 2 are closed and child 3 is mid-`build`, when `.worktrees/demo` is removed and recreated from the leaf branch and the feature resumes, then `coverage_binding` re-seals the envelope and the next region step dispatched is child 3's `acceptance_specs`. Child 3's gitignored region evidence does not survive recreation. | 10.2 | "the next dispatched region step is child 3's `acceptance_specs`" | diff-local |
| Story 1 happy: Given a two-child baseline in which child 1 is closed by a closure ref whose tip has no commits past its parent (an empty child), when the feature resumes, then child 1 stays closed and child 2 is active. | 4 | "with positions 1,2 and such a child 1 the result is `active` child 2" | diff-local |
| Story 1 negative: Given a two-child baseline in which `feat/c1/demo` has just been created at `B` with no commits and no closure ref, when the daemon restarts, then child 1 is still the active child, even though the leaf branch contains child 1's tip. | 4 | "returns `active` child 1, even though the leaf contains child 1's tip" | diff-local |
| Story 1 negative: Given a three-child baseline with child 1 closed, when an operator commits directly onto `feat/c1/demo` so that its tip is no longer an ancestor of `feat/c2/demo`, then the next dispatch halts needs-human naming child 1 and "restack required (#2943)", and no region step runs. | 10.1, 5 | "the run writes a needs-human HALT naming child 1 and `restack required (#2943)` and dispatches no region step" | diff-local |
| Story 1 negative: Given a two-child baseline with child state present, when the region is about to dispatch and the `coverage_binding` envelope is absent, then the run halts needs-human naming the missing envelope, and no region state is written to the flat `.pipeline/` paths. | 10.1 | "the flat region files outside `.pipeline/children/` (`gates/<region step>.json`, region keys of `conduct-state.json`, `kickback-ledger.json` gate entries, test-suite and acceptance evidence files) are byte-identical before and after the halt" | diff-local |
| Story 1 negative: Given a two-child baseline in which the worktree is in detached HEAD, when the cursor is resolved, then the run halts needs-human naming the detached HEAD rather than treating the feature as having no child. | 10.1 | "naming the missing envelope or the detached HEAD, dispatches no region step" | diff-local |
| Story 2 happy: Given a two-child baseline at `coverage_binding` PASS, when the region is entered, then `feat/c1/demo` is created at `B`, the worktree is switched to it, `.pipeline/children/1/` exists, and a `child_started` event with `child: 1` is persisted to `.pipeline/events.jsonl`. | 10, 6, 7 | "on region entry HEAD is `feat/c1/demo`" | diff-local |
| Story 2 happy: Given a three-child baseline in which child 1's `acceptance_specs`, `build`, `test_suite` and `build_review` have all passed, when the loop reaches the region exit, then `refs/conductor/demo/closed/c1` points at child 1's tip, `feat/c2/demo` is created at that tip, the worktree is switched to it, `current-task` is cleared, and `child_closed` (child 1), `child_switched` (1→2) and `child_started` (child 2) are persisted in that order. | 10, 8, 7 | "`refs/conductor/demo/closed/c1` equals `C1`, `feat/c2/demo` equals `C1`, HEAD is `feat/c2/demo` and `.pipeline/current-task` is absent" | diff-local |
| Story 2 happy: Given a two-child baseline in which a pre-region halt record was committed on `feat/daemon-demo` at `H` and the halt was cleared, when the region is entered, then `feat/c1/demo` is created at `H`, and the later leaf move succeeds because the leaf has no commits of its own. | 10, 6, 8 | "entering the region creates `feat/c1/demo` equal to `H`" | diff-local |
| Story 2 happy: Given a stacked feature with positions `1` and `3` (a gap), when child 1 closes, then the next child created is `feat/c3/demo` and no `feat/c2/demo` is created. | 10, 6 | "the loop creates `feat/c3/demo` at `C1` as the next child, and no `feat/c2/demo` ref is ever created" | diff-local |
| Story 2 negative: Given a three-child baseline in which child 1's `build_review` has not passed, when the loop selects its next step, then no `feat/c2/demo` branch is created and no task of child 2 is dispatched. | 10 | "no dispatch for tasks `T3`/`T4` and no `feat/c2/demo` creation happens before child 1's `build_review` PASS" | diff-local |
| Story 2 negative: Given a two-child baseline in which a branch named exactly `feat/c1` already exists, when the region is entered, then the run halts needs-human naming `refs/heads/feat/c1`, and no `feat/c1/demo` branch is created. | 10.1, 6 | "naming `refs/heads/feat/c1` (reserved namespace)" | diff-local |
| Story 2 negative: Given a three-child baseline in which child 1 closes while the worktree holds an uncommitted change to `src/a.ts`, when the switch to child 2 is attempted, then the switch is refused naming `src/a.ts`, no `git stash` entry is created, and the change is still in the worktree. | 7 | "returns a refusal naming `src/a.ts`, `git stash list` is unchanged" | diff-local |
| Story 2 negative: Given a stacked feature whose envelope records 3 positions while the project config now sets `stacked_prs.max_slices: 2`, when the first child would be created, then the run halts needs-human naming `stacked_prs.max_slices`, and no child branch is created. | 10.1, 6 | "or `stacked_prs.max_slices` respectively, and no child branch is created" | diff-local |
| Story 2 negative: Given a three-child baseline in which `feat/c2/demo` was created by another process between the probe and the creation, when the engine creates it, then the compare-and-swap fails and the run halts needs-human naming the branch instead of overwriting it. | 10.1 | "the run writes a needs-human HALT naming `feat/c2/demo`, and that ref keeps the concurrently written value" | diff-local |
| Story 3 happy: Given a two-child baseline in which child 1 closes at tip `C1` and `feat/daemon-demo` is still at `B`, when the loop moves to child 2, then `feat/daemon-demo` points at `C1`, the worktree is on `feat/daemon-demo`, and no `feat/c2/demo` branch exists. | 10, 8 | "in a two-child run after the leaf move HEAD is `feat/daemon-demo`" | diff-local |
| Story 3 happy: Given a three-child baseline in which the leaf's region passes, when the loop continues, then the next step is the first whole-feature step after `build_review` (e.g. `manual_test`), run on `feat/daemon-demo`. | 10 | "the next dispatched step is `manual_test` on `feat/daemon-demo`" | diff-local |
| Story 3 negative: Given a two-child baseline in which `feat/daemon-demo` has gained a commit of its own (not in `C1` or `origin/main`) before child 1 closes, when the leaf move is attempted, then the run halts needs-human naming the leaf branch and its extra commit, and the leaf ref is unchanged. | 10.1, 8 | "naming the leaf branch (and the extra commit's sha in the first case)" | diff-local |
| Story 3 negative: Given a two-child baseline in which the leaf ref changes between the guard check and the move, when the move runs, then the compare-and-swap fails, the run halts needs-human, and the leaf is not overwritten. | 10.1, 8 | "or because the leaf ref changed concurrently, the run writes a needs-human HALT" | diff-local |
| Story 4 happy: Given a two-child baseline in which child 1 has passed `test_suite`, when child 2's `test_suite` then fails, then `.pipeline/children/1/gates/test_suite.json` still records PASS and `.pipeline/children/2/gates/test_suite.json` records FAIL. | 9 | "`.pipeline/children/1/gates/test_suite.json` records PASS" | diff-local |
| Story 4 happy: Given a two-child baseline with child 2 active, when the selector, resume, `ai-conductor daemon status` and the dashboard read step state, then they report child 2's region status and the feature's flat whole-feature status together. | 10.2, 9, 13, 10.3 | "reading flat whole-feature status and child 2's region status together" | diff-local |
| Story 4 happy: Given a two-child baseline with child 2 active, when `manual_test` kicks back to `build`, then the `build` demotion is written to child 2's (the leaf's) state, and child 1's state is unchanged. | 11 | "a `manual_test` kickback to `build` with child 2 active demotes `build` in `.pipeline/children/2/conduct-state.json`" | diff-local |
| Story 4 negative: Given a two-child baseline with child state present, when the flat verdict lister or flat test-suite evidence probe runs, then entries under `.pipeline/children/` are not included. Only the overlay reads child state. | 9 | "`readAllVerdicts` and the flat test-suite evidence probe return the same result with and without a `.pipeline/children/` directory present" | diff-local |
| Story 4 negative: Given a two-child baseline with child state present, when `stacked_prs.enabled` is turned off and the feature resumes, then region state is still read from and written to the active child's directory, and no file under `.pipeline/gates/` for a region step is created or modified. | 10.2, 11 | "the selector reads region step status from `.pipeline/children/<active>/conduct-state.json`, not the flat file" | diff-local |
| Story 4 negative: Given a two-child baseline with child 2 active, when a rebase invalidates `build_review`, then the stale mark lands in child 2's state, and `.pipeline/conduct-state.json` gains no region key. | 11 | "a rebase invalidation of `build_review` with child 2 active marks it stale in child 2's state" | diff-local |
| Story 4 negative: Given a two-child baseline, when a whole-feature gate's kickback targets `plan` or `coverage_binding`, then it behaves exactly as today and no child state is changed. | 11 | "a kickback targeting `plan` or `coverage_binding` produces the same flat state change" | diff-local |
| Story 5 happy: Given a two-child baseline at child 1's `acceptance_specs`, when the `writing-system-tests` skill is dispatched, then its inputs name only story `1`'s criteria, and the RED marker and run contract are written under `.pipeline/children/1/`. | 14 | "the child-1 `acceptance_specs` dispatch input names story `1`'s criteria and no story `2` criterion" | diff-local |
| Story 5 happy: Given a two-child baseline at child 2's `acceptance_specs`, where every story-2 criterion is disposed (no spec files changed since child 1's tip), when the completion check runs, then disposition-only completion passes against story `2`'s criteria alone. | 15 | "disposition-only completion passes" | diff-local |
| Story 5 happy: Given a stacked feature whose child 1 owns no story (infrastructure tasks only), when child 1's `acceptance_specs` completes, then its verdict records outcome `no-owned-criteria` and the region proceeds to `build`. | 18 | "records outcome `no-owned-criteria`, no `writing-system-tests` dispatch occurs" | diff-local |
| Story 5 negative: Given a two-child baseline at child 2's `acceptance_specs`, when the disposition record omits a story `2` criterion, then completion fails naming the omitted criterion id. | 15 | "naming that criterion id as omitted" | diff-local |
| Story 5 negative: Given a two-child baseline at child 2's `acceptance_specs`, when the disposition record also lists a story `1` criterion, then completion fails naming that criterion as not owned by child 2. | 15 | "naming that criterion as not owned by child 2" | diff-local |
| Story 5 negative: Given a two-child baseline at child 2's `acceptance_specs` in which child 1 committed spec files, when disposition-only completion is evaluated, then child 1's spec files are not attributed to child 2 and do not refuse it. | 17 | "disposition-only completion is not refused for those files" | diff-local |
| Story 5 negative: Given a two-child baseline at child 2's `acceptance_specs` in which `feat/c1/demo` is missing, when spec attribution is evaluated, then disposition-only completion is refused naming the missing parent. | 17 | "disposition-only completion is refused with a reason naming the missing parent branch" | diff-local |
| Story 5 negative: Given a stacked feature whose child 2 owns stories, when its RED marker reports `failed: 0` and no recorded-RED exception is present, then completion fails as today. | 19 | "`failed: 0` without an exception is refused as today" | diff-local |
| Story 5 negative: Given a two-child baseline at child 2's `acceptance_specs` in which a story-2 spec already passes because child 1 implemented that behavior, when the RED marker records a `prior-child-green` exception attributed to child 1's closure tip, then completion accepts it. The same exception attributed to any other SHA is refused, naming the attribution. | 19 | "a `prior-child-green` exception attributed to `refs/conductor/demo/closed/c1`'s tip is accepted" | diff-local |
| Story 6 happy: Given a two-child baseline at child 1's `build`, when `T1` and `T2` are resolved and `T3`, `T4` are pending, then child 1's `build` completes. | 22 | "with `T1`,`T2` resolved and `T3`,`T4` pending, `build` completes" | diff-local |
| Story 6 happy: Given a two-child baseline in which a remediation task `rem-1` is appended while child 2 is active, when child 2's `build` completion is evaluated, then `rem-1` is part of child 2's task set, and its child is recorded beside the appended-id record. | 22, 21 | "`rem-1` recorded to child 2 is part of child 2's task set" | diff-local |
| Story 6 negative: Given a two-child baseline at child 1's `build`, when `T2` is unresolved, then completion fails naming `T2` as pending and does not name `T3` or `T4`. | 22 | "with `T2` unresolved it fails naming `T2` only" | diff-local |
| Story 6 negative: Given a two-child baseline at child 2's `build`, when a dispatch resolves no child-2 task and HEAD did not move, then it is recorded as `no_task_progress` even though child 1's tasks are all resolved. | 22 | "with HEAD unmoved is classified `no_task_progress` although child 1's tasks are resolved" | diff-local |
| Story 6 negative: Given a two-child baseline at child 2's `build`, when a dispatch resolves no child-2 task but HEAD moved, then it is not recorded as `no_task_progress`, as today. | 22 | "with HEAD moved it is not" | diff-local |
| Story 6 negative: Given a two-child baseline in which a remediation task's recorded child is missing, when child 2's `build` completion is evaluated, then completion fails closed naming the task. | 22 | "a remediation id with no recorded child fails child 2's completion naming the id" | diff-local |
| Story 7 happy: Given a two-child baseline with `feat/c1/demo` checked out, when a commit carries `Task: T1`, then the commit-msg hook accepts it. | 23 | "a commit with `Task: T1` succeeds" | diff-local |
| Story 7 happy: Given a feature with no children on `feat/daemon-other`, when a commit carries any valid task id, then the hook behaves exactly as today and the membership check abstains. | 23 | "on `feat/daemon-other` (no children) the hook output and exit status for a valid task id are identical to today" | diff-local |
| Story 7 negative: Given a two-child baseline with `feat/c1/demo` checked out, when a commit carries `Task: T3`, then the hook rejects it, naming task `T3`, child 2 as its owner and child 1 as the checked-out child, and no commit is created. | 23 | "a commit with `Task: T3` is rejected with a message naming `T3`, child 2 and child 1" | diff-local |
| Story 7 negative: Given a two-child baseline with `feat/c1/demo` checked out, when `.pipeline/current-task` still holds `T3` from an earlier session, then the stamped `Task: T3` commit is rejected the same way. | 23 | "with `.pipeline/current-task` holding `T3`, the stamped commit is rejected the same way" | diff-local |
| Story 7 negative: Given a two-child baseline with `feat/c1/demo` checked out, when the membership source cannot be read (missing envelope), then the hook rejects the commit naming the unreadable membership. | 23 | "with the envelope missing the commit is rejected naming the unreadable membership" | diff-local |
| Story 7 negative: Given a two-child baseline, when an engine commit runs with `CONDUCT_ENGINE_COMMIT` set, then the membership check is bypassed exactly as the existing scope check is. | 23 | "with `CONDUCT_ENGINE_COMMIT` set a cross-child commit succeeds" | diff-local |
| Story 8 happy: Given a two-child baseline with `full_suite: once` at child 1's `test_suite`, when the scoped run passes, then `.pipeline/children/1/test-suite-evidence.json` records the PASS with child 1's base, and no aggregate run is required. | 26 | "a passing scoped run writes `.pipeline/children/1/test-suite-evidence.json` with child 1's base" | diff-local |
| Story 8 happy: Given a two-child baseline with `full_suite: once` at the leaf's `test_suite`, when it runs, then an aggregate PASS is required and recorded in the leaf's evidence. | 26 | "`test_suite` requires and records an aggregate PASS in the leaf's evidence" | diff-local |
| Story 8 happy: Given a two-child baseline at the FINISH fence, when the fence re-verifies `test_suite`, then it reads and writes the leaf child's evidence and verdict, and complete-verifier accepts the leaf's evidence. | 27 | "the fence reads and writes `.pipeline/children/2/` evidence and verdict" | diff-local |
| Story 8 negative: Given a two-child baseline at child 2's `test_suite`, when the scoped selection's base is unresolvable (`feat/c1/demo` missing), then the run falls back to the aggregate suite as the full-suite site's fail-closed policy requires. | 25 | "with `feat/c1/demo` missing, full-suite selection runs the aggregate suite" | diff-local |
| Story 8 negative: Given a two-child baseline at the FINISH fence, when the leaf's evidence has no aggregate PASS, then the fence fails as today and no flat `.pipeline/test-suite-evidence.json` is written. | 27 | "when the leaf evidence lacks an aggregate PASS, the fence fails as today" | diff-local |
| Story 8 negative: Given a two-child baseline in which child 1's evidence records an aggregate PASS, when the leaf's `test_suite` runs under `full_suite: once`, then child 1's PASS does not satisfy the leaf's aggregate requirement. | 26 | "child 1's recorded aggregate PASS does not satisfy that requirement" | diff-local |
| Story 9 happy: Given a three-child baseline at child 2's `build_review`, when inputs are assembled, then the review base is `feat/c1/demo`'s tip, `baseKind` is `child-parent`, and the changed files are only those changed since that tip. | 24 | "inputs carry base = `feat/c1/demo` tip, `baseKind: 'child-parent'`" | diff-local |
| Story 9 happy: Given a three-child baseline at child 1's `build_review`, when inputs are assembled, then the base is resolved exactly as today (merge-base with the default branch). | 24 | "at child 1 the inputs equal those computed for a feature with no children" | diff-local |
| Story 9 happy: Given a three-child baseline at child 2's `build_review`, when a changed child-2 test's `Covers:` names task `T1` (child 1), then it resolves against the whole plan. | 24 | "a changed test whose `Covers:` names `T1` resolves against the whole plan" | diff-local |
| Story 9 happy: Given a two-child baseline in which child 1's `build_review` has open remediation cases, when child 2 is reviewed, then child 2 sees only cases under `.pipeline/children/2/`. | 28 | "child 2's `build_review` loads zero cases and writes new ones under `.pipeline/children/2/`" | diff-local |
| Story 9 negative: Given a three-child baseline at child 2's `build_review`, when `feat/c1/demo` is missing, then input assembly fails with `MergeBaseError` naming the missing parent, and no review dispatch occurs. | 24 | "with `feat/c1/demo` missing assembly throws `MergeBaseError` naming the parent with no review dispatch" | diff-local |
| Story 9 negative: Given a two-child baseline after the leaf's FINISH rebase, when the leaf's `build_review` re-runs and child 1's tip cannot be translated through the rewrite map, then input assembly fails closed with `parent-not-ancestor` rather than grading against the default branch. | 24, 16 | "assembly throws `MergeBaseError` with `parent-not-ancestor`" | diff-local |
| Story 9 negative: Given a three-child baseline at child 2's `build_review`, when the degraded-fetch check runs, then no degraded-fetch warning is emitted for the `child-parent` base. | 24 | "and no degraded-fetch warning" | diff-local |
| Story 10 happy: Given a two-child baseline with the `security` rubric enabled, at child 1's `build_review`, when rubrics are projected, then `testQuality` runs on child 1's diff and `security` is skipped with reason `leaf-only`, not `disabled`. | 29 | "`security` is reported skipped with reason `leaf-only` (not `disabled`)" | diff-local |
| Story 10 happy: Given the same baseline at the leaf's `build_review`, when rubrics are projected, then `security` grades a whole-feature snapshot based on the default branch, and `testQuality` grades the leaf's child diff. | 29 | "`security` grades a snapshot whose merge-base is the default-branch merge-base" | diff-local |
| Story 10 negative: Given the same baseline at the leaf's `build_review`, when the whole-feature merge-base cannot be resolved, then the security projection fails with `MergeBaseError`, and the lap is not recorded as a PASS. | 29 | "the security projection fails with `MergeBaseError` and no PASS verdict is written" | diff-local |
| Story 10 negative: Given a feature with no children and `security` enabled, when `build_review` runs, then exactly one snapshot is assembled and security grades it as today. | 29 | "a feature with no children assembles exactly one snapshot for both rubrics" | diff-local |
| Story 11 happy: Given a two-child baseline in which child 1's `build_review` used 4 cumulative kickbacks and then passed, when child 2's `build_review` kicks back for the first time, then child 2's ledger records cumulative 1, and child 1's ledger still records its own history. | 30 | "child 2's first kickback records cumulative 1 in `.pipeline/children/2/kickback-ledger.json`" | diff-local |
| Story 11 happy: Given a two-child baseline, when a `build_review` convergence credit is applied to child 2, then the credit and its receipt are written to `.pipeline/children/2/kickback-ledger.json` in one lease. | 30 | "writes the credit and its receipt to child 2's ledger in one lease" | diff-local |
| Story 11 happy: Given a two-child baseline in which child 1's `build` was selected 5 times and then passed, when child 2's `build` is selected, then the repeated-selection count for child 2 starts at 1. | 31 | "child 2's first `build` selection is counted as 1" | diff-local |
| Story 11 negative: Given a two-child baseline with child 2 active, when child 2's `build_review` cumulative count exceeds 5, then the run halts needs-human, the halt reason names child 2, and child 1's ledger is unchanged. | 31 | "child 2's sixth cumulative `build_review` kickback writes a needs-human HALT naming child 2" | diff-local |
| Story 11 negative: Given a two-child baseline with child 2 active, when child 2's `build` is selected a seventh time, then the run halts needs-human, naming `build` and child 2. | 31 | "child 2's seventh selection writes a needs-human HALT naming `build` and child 2" | diff-local |
| Story 11 negative: Given a two-child baseline, when any code path tries to write `growth`, `pendingRepair` or `effectiveGrowthCap` into a child ledger, then the write is refused, and plan growth stays recorded only in the flat ledger. | 30 | "writing `growth`, `pendingRepair` or `effectiveGrowthCap` into a child ledger is refused" | diff-local |
| Story 11 negative: Given a two-child baseline with child 2 active, when `ai-conductor daemon status` shows the kickback budget, then it reports child 2's counts, labeled with the child. | 13 | "the daemon status budget view prints child 2's `build_review` counts under a `Child: 2` label" | diff-local |
| Story 12 happy: Given a two-child baseline with child 2 active, when `ai-conductor rewind --to build` runs without `--child`, then child 2's region is demoted from `build`, and child 1's state is unchanged. | 32 | "`ai-conductor rewind --to build` demotes child 2's region from `build`" | diff-local |
| Story 12 happy: Given a two-child baseline halted on child 2's `build_review` cumulative cap, when `ai-conductor kickback-budget raise --feature demo --gate build_review --by 1 --rationale "..." --child 2` runs, then child 2's cap evidence is raised, and the re-kick's resume authorization reads child 2's ledger and resumes. | 33 | "read from `.pipeline/children/2/kickback-ledger.json`, resumes the feature" | diff-local |
| Story 12 happy: Given a two-child baseline with child 2 active, when `ai-conductor kickback-budget reset --feature demo --gate build_review --rationale "..." --child 2` runs, then child 2's ledger gate entries are reset, and child 1's and the flat ledger are unchanged. | 33 | "resets child 2's gate entries and leaves child 1's and the flat ledger byte-identical" | diff-local |
| Story 12 happy: Given a two-child baseline with child 2 active, when `ai-conductor task start T3` runs without `--child`, then membership is validated against child 2. | 32 | "`ai-conductor task start T3` succeeds" | diff-local |
| Story 12 negative: Given a two-child baseline with child 1 closed, when `ai-conductor rewind --to build --child 1` runs, then it is refused, naming child 1 as closed and #2943, and no state changes. | 32 | "exits non-zero naming child 1 as closed and `#2943`, and no `.pipeline` file changes" | diff-local |
| Story 12 negative: Given a two-child baseline with child 2 active, when `ai-conductor task start T1` runs without `--child`, then it is refused, naming `T1` as owned by child 1. | 32 | "`ai-conductor task start T1` is refused naming `T1` and child 1" | diff-local |
| Story 12 negative: Given a feature with no children, when each of the three commands runs without `--child`, then its output and exit status are exactly today's. | 32 | "each of the three commands without `--child` produces output and exit status identical to the committed N=1 golden rendering" | diff-local |
| Story 13 happy: Given a two-child baseline with `feat/c1/demo` checked out, when a needs-human halt is written, then `.docs/halted/demo.md` is committed on `feat/c1/demo` with a `Child: 1` field, and no push is attempted. | 34 | "commits a record containing `Child: 1` on `feat/c1/demo`, and the mocked remote runner records no push" | diff-local |
| Story 13 happy: Given a two-child baseline with the leaf active, when a needs-human halt is written, then the record is committed on `feat/daemon-demo` with `Child: 2` and pushed as today. | 34 | "commits a record containing `Child: 2` and pushes `HEAD:refs/heads/feat/daemon-demo`" | diff-local |
| Story 13 negative: Given a two-child baseline with `feat/c1/demo` checked out, when a halt is resolved and the record is superseded, then the superseding commit stays on `feat/c1/demo` and `publishHaltRecord` refuses to push it, naming the child branch. | 34 | "the superseding commit stays on `feat/c1/demo` and `publishHaltRecord` returns a refusal naming the child branch" | diff-local |
| Story 13 negative: Given a two-child baseline with `feat/c1/demo` checked out, when build-failure escalation runs, then it refuses, naming the child branch, and opens no PR. | 34 | "`escalateBuildFailure` on `feat/c1/demo` returns a refusal naming the branch and the mocked `gh` records no PR creation" | diff-local |
| Story 13 negative: Given a feature with no children, when a halt is written, then the record and push behave exactly as today, with no `Child:` field. | 34 | "a halt on a feature with no children produces today's record (no `Child:` line) and push" | diff-local |
| Story 14 happy: Given a three-child baseline with child 2 active, when a halt is cleared and the re-kick runs, then the play-forward rebase is skipped, a `rebase_skipped_for_stack` event naming child 2 is persisted, and the run resumes at child 2's next step. | 35 | "the next dispatched step is child 2's next region step" | diff-local |
| Story 14 happy: Given a three-child baseline with child 2 active, when the default branch advances and the base-advance sweep re-kicks the feature, then the rebase is skipped the same way. | 35 | "a default-branch advance re-kick with child 2 active skips the rebase the same way" | diff-local |
| Story 14 happy: Given a two-child baseline with the leaf active, when a re-kick runs, then the leaf alone is rebased as today. | 35 | "with the leaf active the leaf alone is rebased" | diff-local |
| Story 14 negative: Given a three-child baseline with child 2 active, when the re-kick runs, then neither `feat/c1/demo` nor `feat/c2/demo` is rewritten (their SHAs are unchanged). | 35 | "`feat/c1/demo` and `feat/c2/demo` keep their SHAs" | diff-local |
| Story 14 negative: Given a feature with no children, when a re-kick runs, then the mandatory play-forward rebase runs exactly as today, and no `rebase_skipped_for_stack` event is emitted. | 35 | "on a feature with no children the play-forward rebase runs as today and no `rebase_skipped_for_stack` event is emitted" | diff-local |
| Story 15 happy: Given a two-child baseline, when it runs to the leaf's `build_review` PASS, then `.pipeline/events.jsonl` contains `child_started` (1), `child_closed` (1), `child_switched` (1→2) and `child_started` (2), each with the child, position and branch. | 12 | "the `child_*` sequence `child_started` (1), `child_closed` (1), `child_switched` (1→2), `child_started` (2) appears with child, position and branch" | diff-local |
| Story 15 happy: Given a two-child baseline with child 2 active, when a region step starts, then its `step_start` and `gate_verdict` events carry `child: 2`. | 12 | "`step_start` and `gate_verdict` for child 2's region steps carry `child: 2`" | diff-local |
| Story 15 happy: Given a two-child baseline with child 2 active, when `ai-conductor daemon status` and the dashboard render the feature, then both show `child 2/2`. | 13 | "both contain `child 2/2`" | diff-local |
| Story 15 negative: Given a feature with no children, when it runs, then no event carries a `child` key, and no `child_*` event is emitted. | 12 | "a run with no children emits no `child` key and no `child_*` event" | diff-local |
| Story 15 negative: Given a two-child baseline, when a whole-feature step (`manual_test`) starts, then its events carry no `child` key. | 12 | "events for `manual_test` carry no `child` key" | diff-local |
| Story 16 happy: Given a two-child baseline with child 1 closed, when `coverage_binding` re-runs on an existing invalidation trigger with unchanged positions, then the envelope is re-sealed and the build continues. | 36 | "with child 1 closed and positions unchanged, a re-run re-seals and the run continues" | diff-local |
| Story 16 happy: Given a two-child baseline with child 1 closed, when a re-run re-owns story `2` without moving any task, then a `story_reowned` event naming the story is emitted. | 36 | "persists `story_reowned` naming story `2`" | diff-local |
| Story 16 negative: Given a two-child baseline with `feat/c1/demo` existing, when a re-seal would add position `3`, then `coverage_binding` halts needs-human naming the added position, and the existing envelope is left untouched. | 36 | "a re-seal adding position 3 ends needs-human naming position 3 and the envelope file is byte-identical" | diff-local |
| Story 16 negative: Given a two-child baseline with `.pipeline/children/2/` existing, when a re-seal would remove position `2`, then `coverage_binding` halts needs-human naming the removed position. | 36 | "removing position 2 ends needs-human naming position 2" | diff-local |
| Story 17 happy: Given #3019's N=1 golden suite, when it runs after this change, then every cell is byte-identical to its committed fixtures. | 1 | "every existing golden cell (flag off, flag on unsliced, flag off sliced) is still byte-identical to its committed fixture" | diff-local |
| Story 17 happy: Given a project with `stacked_prs.enabled: true` and an unsliced plan, when the feature builds, then no child branch, closure ref, child directory, `child` event field or hook membership check appears. | 1 | "the commit-msg hook's membership check abstains" | diff-local |
| Story 17 happy: Given the config consumer registry, when its drift test runs, then `stacked_prs.enabled` lists the BUILD cursor's creation path among its consumers. | 37 | "listing `child-cursor.ts` as a consumer" | diff-local |
| Story 17 negative: Given a project with `stacked_prs.enabled: true` and an eligible plan with exactly one slice, when it builds, then no child is created and the golden output matches its own committed cell. It also matches the unsliced cell, except for the envelope's slice-membership and story-ownership fields. | 1 | "equal the flag-on-unsliced cell output except the envelope's slice-membership and story-ownership fields" | diff-local |
| Story 17 negative: Given a project with `stacked_prs.enabled: false` and a sliced plan, when it builds, then no child is created and the golden output matches its own committed cell. It also matches the flag-off cell, except for the envelope's slice-membership field. | 1 | "the flag-off-sliced cell output equals the flag-off (unsliced) cell output except the envelope's slice-membership field" | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-07-11-verdict-aware-resume-entry#D1 | task | task-10.2 | the clamp does not pull the index back to child 2's `acceptance_specs` |
| adr-2026-07-11-verdict-aware-resume-entry#D2 | task | task-10.2 | `findResumeIndex`, `resolveRunnableResumeEntry` and the resume clamp over the same overlay resume at child 2's `build` |
| adr-2026-07-11-verdict-aware-resume-entry#D3 | existing | none | `fromStep` override validated by `validateFromStep` in src/conductor/src/engine/steps.ts:654 and passed from src/conductor/src/index.ts:1871, exempt from resumeClamp; unchanged |
| adr-2026-07-11-verdict-aware-resume-entry#D4 | existing | none | `checkGate` stays state-only in src/conductor/src/engine/gates.ts:15; unchanged |
| adr-2026-07-11-verdict-aware-resume-entry#D5 | task | task-10.2 | `findResumeIndex`, `resolveRunnableResumeEntry` and the resume clamp over the same overlay resume at child 2's `build` |
| adr-2026-07-21-demote-task-stamping-to-telemetry#D1 | existing | none | Stamp-gating graph deleted, so no `deriveCompletion` or `reconcileStatusFromStamps` exists in src/conductor/src/engine/autoheal.ts (only a retirement comment at src/conductor/src/engine/artifacts.ts:2852); unchanged |
| adr-2026-07-21-demote-task-stamping-to-telemetry#D2 | task | task-23 | a commit with `Task: T3` is rejected with a message naming `T3`, child 2 and child 1 |
| adr-2026-07-21-demote-task-stamping-to-telemetry#D3 | task | task-23 | on `feat/daemon-other` (no children) the hook output and exit status for a valid task id are identical to today |
| adr-2026-07-21-demote-task-stamping-to-telemetry#D4 | existing | none | `parsePlanTaskPaths` and `TASK_ID_PATTERN` preserved (relocated) in src/conductor/src/engine/plan-task-parse.ts:458 and :15; unchanged |
| adr-2026-07-21-demote-task-stamping-to-telemetry#D5 | task | task-23 | with `CONDUCT_ENGINE_COMMIT` set a cross-child commit succeeds |
| adr-2026-07-23-trailer-union-build-step-routing#D1 | existing | none | Trailers are routing only, and build_review stays the completion authority. The build predicate hands off via `resolveTaskIdsWithDiagnostics` at src/conductor/src/engine/artifacts.ts:2917; unchanged (per-child scoping is under D2) |
| adr-2026-07-23-trailer-union-build-step-routing#D2 | task | task-22 | with `T2` unresolved it fails naming `T2` only |
| adr-2026-07-23-trailer-union-build-step-routing#D3 | existing | none | Union only widens: `resolveTaskIdsWithDiagnostics` in src/conductor/src/engine/task-progress.ts:87 still resolves rows plus trailers; unchanged |
| adr-2026-07-23-trailer-union-build-step-routing#D4 | existing | none | Plain trailer-id fold with no SHA reachability or path corroboration in `resolveTaskIds` src/conductor/src/engine/task-progress.ts:168; unchanged |
| adr-2026-07-23-trailer-union-build-step-routing#D5 | existing | none | Fail-closed gate and fail-soft trailer reads in the build predicate (src/conductor/src/engine/artifacts.ts ~2857-2941, `no tasks in plan` and parse-failure branches); unchanged |
| adr-2026-07-23-trailer-union-build-step-routing#D6 | no-change | none | Contract-text sync was a one-time same-PR edit, already landed (skills/pipeline/SKILL.md:122-126 states trailer is non-authoritative routing) |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D2 | existing | none | Tree-hash witness `classifyBuildProgress` in src/conductor/src/engine/kickback-escalation.ts:35; unchanged |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D1 | task | task-30 | child 2's first kickback records cumulative 1 in `.pipeline/children/2/kickback-ledger.json` |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D3 | existing | none | Tree-keyed count with resolved-count progress in `bumpKickbackGate` src/conductor/src/engine/kickback-ledger.ts:994 and `MAX_KICKBACKS_PER_GATE` :244; unchanged (the per-child entry location is D1) |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D4 | task | task-31 | exceeding the per-gate kickback cap (`MAX_KICKBACKS_PER_GATE`) for a gate at child 2 writes a needs-human HALT naming the gate, the reason and child 2 |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D5 | no-change | none | The wiring_check step is retired (no `wiring_check` reference remains in src/conductor/src, and `DEPRECATED_WIRING_ADR` is in src/conductor/src/engine/config.ts:183), so #2942 has no wiring capture/check pair to touch |
| adr-2026-07-26-cross-dispatch-kickback-livelock-bound#D6 | existing | none | `kickback_escalation.enabled` gate read as `kickbackEscalationEnabled` in src/conductor/src/engine/conductor.ts:7709; unchanged |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D1 | existing | none | `acceptance_red` variant in src/conductor/src/types/events.ts:1903, emitted via `emitAcceptanceRed` src/conductor/src/engine/conductor.ts:7928. Child tagging uses the existing optional `child` on `ConductorEvent` (events.ts:1936); unchanged |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D2 | task | task-14 | the self-heal runner for child 1 writes `.pipeline/children/1/acceptance-specs-red.json` |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D3 | existing | none | Working/waiting status via `heartbeatBelongsToDispatch` src/conductor/src/engine/step-heartbeat.ts:131, consumed in src/conductor/src/engine/daemon-dashboard.ts:13-92; unchanged (the dashboard's overlay read belongs to new-ADR decision 4) |
| adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance#D4 | task | task-14 | the predicate reads only that path |
| adr-2026-08-09-recorded-red-exception-for-remediation#D1 | task | task-19 | a `prior-child-green` exception attributed to `refs/conductor/demo/closed/c1`'s tip is accepted |
| adr-2026-08-09-recorded-red-exception-for-remediation#D2 | existing | none | `viaException` on `acceptance_red` (src/conductor/src/types/events.ts:1908) set from completion at src/conductor/src/engine/artifacts.ts:3090; unchanged |
| adr-2026-08-09-recorded-red-exception-for-remediation#D3 | existing | none | Unrecorded green rejection text `0 failed — RED not established` in `validateAcceptanceRedEvidence` src/conductor/src/engine/artifacts.ts:1708; unchanged |
| adr-2026-08-09-recorded-red-exception-for-remediation#D4 | task | task-19 | carries it forward unchanged into the fresh marker at the same path |
| adr-2026-08-09-recorded-red-exception-for-remediation#D5 | no-change | none | Remediate-skill obligation already landed (skills/remediate/SKILL.md:306 RED-waiver obligation, HARNESS.md:106). The #2942 `prior-child-green` recording belongs to writing-system-tests under D1 |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D1 | task | task-30 | child 2's first kickback records cumulative 1 in `.pipeline/children/2/kickback-ledger.json` |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D2 | no-change | none | Superseded by adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence D1 (PASS clears nothing). `resetKickbackGateCumulativeInLedger` no longer exists in src/conductor/src |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D3 | task | task-31 | child 2's sixth cumulative `build_review` kickback writes a needs-human HALT naming child 2 |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D4 | existing | none | `cumulative_kickback_bound.enabled` config block in src/conductor/src/types/config.ts:633 and src/conductor/src/engine/config.ts:145; unchanged |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D5 | existing | none | Optional `cumulativeCount` on `kickback` event src/conductor/src/types/events.ts:1517, emitted at src/conductor/src/engine/conductor.ts:13951; unchanged |
| adr-2026-08-12-cumulative-build-review-convergence-bound#D6 | existing | none | Only the build_review kickback site consults `MAX_CUMULATIVE_KICKBACKS_BUILD_REVIEW` (src/conductor/src/engine/kickback-ledger.ts:247, used at conductor.ts:13908); unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D1 | existing | none | Routing on `kind: 'infrastructure-failure'` via `BuildReviewInfrastructureFailure` src/conductor/src/engine/build-review-domain.ts:126; unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D2 | existing | none | Total closed reason mapping `mapBuildReviewCoordinatorFailureReason` src/conductor/src/engine/build-review-domain.ts:22-24; unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D3 | existing | none | Mechanical fault publishes no aggregate and charges no budget (coordinator infrastructure path in src/conductor/src/engine/build-review-coordinator.ts:666-674); unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D4 | task | task-30 | increments the mechanical counter on child 2's ledger entry |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D5 | task | task-31 | exhausting the `build_review` mechanical-fault allowance at child 2 writes the existing needs-human exhaustion HALT naming child 2 |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D6 | existing | none | `build-review record-reduced-coverage` parsed in src/conductor/src/cli.ts:158-209 and :769; unchanged (see flag: store location per child) |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D7 | existing | none | Identity is rubric plus closed reason over `BuildReviewInfrastructureFailureReason` src/conductor/src/engine/build-review-domain.ts:22; unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D8 | existing | none | Single relaxation in `deriveEffectiveBuildReviewVerdict` src/conductor/src/engine/build-review-aggregate.ts:471; unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D9 | existing | none | Reduced-coverage stamping via the dispositions renderer in src/conductor/src/engine/build-review-dispositions.ts; unchanged |
| adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane#D10 | existing | none | Occurrences on existing `build_review_rubric_infrastructure_failure` src/conductor/src/types/events.ts:701; unchanged |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D1 | task | task-30 | child 1's ledger is unchanged |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D2 | task | task-30 | writes the credit and its receipt to child 2's ledger in one lease |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D3 | existing | none | Optional `convergenceCredit` field on the `kickback` event src/conductor/src/types/events.ts:1518-1521; unchanged |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D4 | no-change | none | Adds no config switch, and #2942 adds none (`cumulative_kickback_bound.enabled` src/conductor/src/engine/config.ts:145 is unchanged) |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D5 | existing | none | Credit scoped to `build_review` only: `creditKickbackGateLaps` applied to `ledger.gates.build_review` at src/conductor/src/engine/conductor.ts:15410 and rebase-transition.ts:62; unchanged |
| adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence#D6 | existing | none | Entry-wide rule in `creditKickbackGateLaps` (credits every lap-counting field) src/conductor/src/engine/kickback-ledger.ts:318; unchanged |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D1 | task | task-32 | `ai-conductor rewind --to build` demotes child 2's region from `build` |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D2 | existing | none | Demotions through `ConductStateStore` mutations in `rewindState` and `rewindChildState`, src/conductor/src/engine/rewind.ts:501 and :555; unchanged |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D3 | task | task-32 | `ai-conductor rewind --to coverage_binding` likewise leaves closed child 1's state byte-identical |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D4 | existing | none | Verdict plus HALT clear via `clearHaltAtomically` src/conductor/src/engine/rewind.ts:118; unchanged |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D5 | existing | none | `operator_rewind` event (src/conductor/src/types/events.ts:491) emitted with optional child at src/conductor/src/engine/rewind.ts:437; unchanged |
| adr-2026-08-19-operator-step-rewind-through-the-mutation-port#D6 | existing | none | Operator-only entry: `detectRewindCommand` and `dispatchRewindCommand` invoked only from src/conductor/src/index.ts:916-918; unchanged |
| adr-2026-08-22-build-review-opt-in-rubric-container#D1 | task | task-29 | `security` is reported skipped with reason `leaf-only` (not `disabled`) |
| adr-2026-08-22-build-review-opt-in-rubric-container#D2 | existing | none | Retired keys `DEPRECATED_BUILD_REVIEW_RUBRIC_IDS` with deprecation warning in src/conductor/src/engine/config.ts:169-245; unchanged |
| adr-2026-08-22-build-review-opt-in-rubric-container#D3 | existing | none | test-quality scope via `parseCoversMarkers` in src/conductor/src/engine/build-review-test-scope.ts:320. The plan body stays whole per new-ADR decision 9; unchanged |
| adr-2026-08-22-build-review-opt-in-rubric-container#D4 | existing | none | Preserved contracts: judged envelope, closed vocabularies and registry in `BUILD_REVIEW_RUBRIC_REGISTRY` src/conductor/src/engine/build-review-registry.ts:107; unchanged |
| adr-2026-08-22-build-review-opt-in-rubric-container#D5 | existing | none | build_review has `skippableForTiers: []` in src/conductor/src/engine/steps.ts:187-193, and empty container is `build_review_no_rubrics` PASS at build-review-coordinator.ts:917; unchanged |
| adr-2026-08-23-committed-halt-record#D1 | existing | none | `.docs/halted/<slug>.md` via `HALT_RECORD_DIR` and `haltRecordPath` in src/conductor/src/engine/halt-record.ts:14-50; unchanged |
| adr-2026-08-23-committed-halt-record#D2 | existing | none | Produced at the single seam `writeHaltMarker` calling `writeHaltRecord`, src/conductor/src/engine/halt-marker.ts:87 and :126; unchanged |
| adr-2026-08-23-committed-halt-record#D3 | existing | none | `isRecordableHaltClass` excludes mechanical, src/conductor/src/engine/halt-record.ts:55; unchanged |
| adr-2026-08-23-committed-halt-record#D4 | task | task-34 | commits a record containing `Child: 1` on `feat/c1/demo` |
| adr-2026-08-23-committed-halt-record#D5 | task | task-34 | the mocked remote runner records no push |
| adr-2026-08-23-committed-halt-record#D6 | existing | none | Non-throwing result-typed arms (`HaltRecordResult`) in src/conductor/src/engine/halt-record.ts:34 and `recordHalt` :118; unchanged |
| adr-2026-08-23-committed-halt-record#D7 | existing | none | `supersedeHaltRecord` src/conductor/src/engine/halt-record.ts:147, called from halt-clear-cli.ts:12 and daemon-deps.ts:7; unchanged |
| adr-2026-08-23-committed-halt-record#D8 | existing | none | `halt_record_written`, `halt_record_write_failed` and `halt_record_push_failed` in src/conductor/src/types/events.ts:1576-1589; unchanged |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D1 | existing | none | Closed category vocabulary `TEST_SUITE_DRIFT_CATEGORIES` src/conductor/src/engine/config.ts:2401; unchanged |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D2 | existing | none | Optional `test_suite.verification` block typed in src/conductor/src/types/config.ts (~525) and validated in src/conductor/src/engine/config.ts; unchanged |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D3 | existing | none | `UNBUDGETABLE_TEST_SUITE_DRIFT_CATEGORIES` src/conductor/src/engine/config.ts:2412; unchanged |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D4 | task | task-26 | a passing scoped run writes `.pipeline/children/1/test-suite-evidence.json` with child 1's base |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D5 | task | task-25 | with the parent present the scoped selection covers only files changed since `feat/c1/demo`'s tip |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D6 | task | task-26 | `test_suite` requires and records an aggregate PASS in the leaf's evidence |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D7 | existing | none | `test_suite_verification` (src/conductor/src/types/events.ts:1430), `build_member_evidence_reused` (:1465) and `rebase_gate_preserved` (:1651); unchanged |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D8 | existing | none | `config init` flags `--test-suite-mode` and `--test-suite-drift-budget` in src/conductor/src/cli.ts:656-657; unchanged |
| adr-2026-08-28-test-suite-drift-budget-and-verification-mode#D9 | existing | none | `--test-suite-command` flag src/conductor/src/cli.ts:658, validated in src/conductor/src/engine/registry-cli.ts:203; unchanged |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D1 | existing | none | Cap terminal remains needs-human (`HaltClass` and `isOperatorActionHalt` src/conductor/src/engine/halt-marker.ts:38-48); unchanged |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D2 | task | task-33 | raises child 2's cap evidence |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D3 | task | task-33 | the re-kick resume authorization, read from `.pipeline/children/2/kickback-ledger.json`, resumes the feature |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D4 | task | task-32 | each of the three commands without `--child` produces output and exit status identical to the committed N=1 golden rendering |
| adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class#D5 | existing | none | Raise grows the named allowance via `stageKickbackBudgetAdjustment` and `applyKickbackBudgetAdjustment`, src/conductor/src/engine/kickback-ledger.ts:1454-1500. Growth stays feature-wide (new-ADR decision 10); unchanged |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D1 | existing | none | Normal-finish prospective merge `classifyProspectiveMerge` src/conductor/src/engine/rebase.ts:88; unchanged |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D2 | existing | none | `classifyMergeableSkip` src/conductor/src/engine/rebase.ts:1195; unchanged |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D3 | existing | none | Active review-input exception `resolveReviewInputs` src/conductor/src/engine/rebase.ts:1255; unchanged |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D4 | existing | none | Conflicting or indeterminate merges enter the existing rebase flow (`ProspectiveMergeResult` src/conductor/src/engine/rebase.ts:80, used at :1376); unchanged |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D5 | task | task-35 | clearing a halt runs the re-kick without any `rebase` invocation |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D6 | task | task-35 | with the leaf active the leaf alone is rebased |
| adr-2026-09-11-finish-mergeability-respects-active-review-inputs#D7 | no-change | none | coverage_binding stays non-tree-attesting (no `treeAttestingCompletion` on its def in src/conductor/src/engine/steps.ts:135), and #2942 adds no resume-validity stamp |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D1 | existing | none | `parseFeatureBranch`, `leafBranchFor`, `childBranchFor` and `isDaemonOwnedBranchName` in src/conductor/src/engine/feature-branch-identity.ts:40-128; unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D2 | existing | none | Child arms: finish-record refusal src/conductor/src/engine/finish-record-cli.ts:237, halt-PR mapping halt-pr-reconciliation.ts:164, park `child-branch` refusal park-reconciliation.ts:78; unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D3 | existing | none | Leaf-exists check `leafRefExists` src/conductor/src/engine/daemon-halt-pr-operations.ts:35, used in github-operations-cli.ts:104; unchanged |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D4 | task | task-6 | returns a needs-human refusal naming `refs/heads/feat/c1` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D5 | task | task-6 | returns a needs-human refusal naming `stacked_prs.max_slices` and creates no branch |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D6 | task | task-8 | moves `feat/daemon-demo` from `B` to `C1` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D7 | task | task-36 | a re-seal adding position 3 ends needs-human naming position 3 |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D8 | task | task-9 | `.pipeline/children/1/gates/test_suite.json` records PASS |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D9 | task | task-31 | child 2's first `build` selection is counted as 1 |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D10 | task | task-4, task-5 | whatever branch is checked out |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D11 | task | task-16 | `parent` with child 1's closure-ref tip (equal to `feat/c1/demo`'s tip) for position 2 |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D12 | task | task-12 | `step_start` and `gate_verdict` for child 2's region steps carry `child: 2` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D13 | task | task-32 | `ai-conductor rewind --to build` demotes child 2's region from `build` |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D14 | task | task-1 | are byte-identical to its own committed fixture |
| adr-2026-10-03-stacked-child-plans-identity-and-state#D15 | task | task-29 | `security` grades a snapshot whose merge-base is the default-branch merge-base |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D1 | existing | none | Engagement gated on `stacked_prs.enabled` at land (src/conductor/src/engine/engineer/land-spec.ts:486) and coverage_binding (step-runners.ts:4795); unchanged |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D2 | existing | none | `deriveStoryOwnership` src/conductor/src/engine/plan-slices.ts:152; unchanged (consumed via envelope `storyOwnership`) |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D3 | existing | none | `evaluateStackEligibility` src/conductor/src/engine/plan-slices.ts:57; unchanged (decision-2 child-existence gate consumes it) |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D4 | existing | none | `parseStackedDeliverySignoff` src/conductor/src/engine/artifacts.ts:4195; unchanged |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D5 | existing | none | Land rung `stacked-delivery` src/conductor/src/engine/engineer/land-spec.ts:134-508 and coverage_binding re-check with fresh `loadConfig` step-runners.ts:4789-4821; unchanged |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D6 | task | task-36 | with child 1 closed and positions unchanged, a re-run re-seals and the run continues |
| adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility#D7 | existing | none | Grammar ceiling `MAX_CHILD_ID` in src/conductor/src/engine/plan-slices.ts:396, and `stacked_prs.max_slices` validation in src/conductor/src/engine/config.ts:136 and :1503-1505; unchanged |
| adr-2026-10-07-per-child-build-region#D1 | task | task-4, task-5, task-10 | returns `active` child 1, even though the leaf contains child 1's tip |
| adr-2026-10-07-per-child-build-region#D2 | task | task-5 | `resolveActiveChild` returns `active`, never `no-child` |
| adr-2026-10-07-per-child-build-region#D3 | task | task-6, task-7, task-8, task-10, task-10.1 | creates `feat/c1/demo` at the leaf's tip at that moment |
| adr-2026-10-07-per-child-build-region#D4 | task | task-9, task-10.2, task-10.3, task-11, task-13 | a region write through the routed port leaves `.pipeline/conduct-state.json` byte-identical |
| adr-2026-10-07-per-child-build-region#D5 | task | task-14, task-15, task-17, task-18, task-19, task-20 | the child-1 `acceptance_specs` dispatch input names story `1`'s criteria and no story `2` criterion |
| adr-2026-10-07-per-child-build-region#D6 | task | task-22, task-21, task-23 | with `T2` unresolved it fails naming `T2` only |
| adr-2026-10-07-per-child-build-region#D7 | task | task-26, task-27 | child 1's recorded aggregate PASS does not satisfy that requirement |
| adr-2026-10-07-per-child-build-region#D8 | task | task-16, task-17, task-24, task-25 | it returns `parent-missing` when `feat/c1/demo` is absent |
| adr-2026-10-07-per-child-build-region#D9 | task | task-24, task-28, task-29 | inputs carry base = `feat/c1/demo` tip, `baseKind: 'child-parent'` |
| adr-2026-10-07-per-child-build-region#D10 | task | task-30, task-31, task-33 | writing `growth`, `pendingRepair` or `effectiveGrowthCap` into a child ledger is refused |
| adr-2026-10-07-per-child-build-region#D11 | task | task-32, task-33, task-34, task-13 | exits non-zero naming child 1 as closed and `#2943` |
| adr-2026-10-07-per-child-build-region#D12 | task | task-35, task-16 | persists `rebase_skipped_for_stack` with `child: 2` |
| adr-2026-10-07-per-child-build-region#D13 | task | task-3, task-12, task-36 | `EVENT_SINKS` declares `child_started`, `child_closed`, `child_switched`, `rebase_skipped_for_stack` and `story_reowned` with `persist: true` |
| adr-2026-10-07-per-child-build-region#D14 | task | task-1, task-37 | every existing golden cell (flag off, flag on unsliced, flag off sliced) is still byte-identical to its committed fixture |

## Verification
- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] Every task has a `Done when:` block of 2–5 falsifiable checks
- [x] Dependencies are explicit and acyclic
- [x] Independent coverage (§7a) and contradiction (§7b) judgements run in fresh subagents

Scope note: 40 tasks puts this plan in the 21–40 warning band. The operator chose full #2942 scope
(one feature). The coherence check maps every task to a story.
