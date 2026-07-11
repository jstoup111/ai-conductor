# Implementation Plan: Port test_conduct_worktree.sh coverage to the TS suite

## Parity Finding: Pre-worktree setup commit-scope

The bash `bin/conduct` includes a `run_worktree_setup()` function (verified in test_conduct_worktree.sh lines 541-559) that commits project-level files (`.docs/decisions/` and `.memory/`) after creating a worktree. The TS conductor does NOT have an equivalent setup commit step — worktrees are created but project-level artifacts are not staged and committed at worktree creation time. This is a documented parity gap (Feature request: implement pre-worktree setup commit in TS conductor). Task 14 closes against this finding rather than writing a test.

---

**Date:** 2026-07-04
**Track:** technical (no PRD)
**Complexity:** Small (`.docs/complexity/port-test-conduct-worktree-sh-coverage-to-the-ts-s.md`)
**Stories:** `.docs/stories/port-test-conduct-worktree-sh-coverage-to-the-ts-s.md`
**Conflict check:** Skipped (Small tier — per harness DECIDE policy)

## Summary
Add black-box vitest tests to `src/conductor/` that port the six genuine coverage gaps from the
925-line whitebox bash test `test/test_conduct_worktree.sh`, so the behaviors survive the file's
removal in cutover PR #226. Test-only work with two possible small production touches (SIGTERM/SIGHUP
handler extension; a recorded parity-gap finding for the setup commit-scope). ~15 tasks.

## Technical Approach
Every task is **black-box**: it imports and drives the real exported `src/engine/` symbol against a
fixture and asserts observable output/state/events — never a grep of source text (the whole point of
the port is to stop pinning bash source shape). Tests live under `src/conductor/test/engine/` (and
`test/execution/` for session), mirroring the `src/`→`test/` layout. Fixtures use `mkdtemp` +
`git init` in `beforeEach` exactly like `test/engine/worktree.test.ts`; the suite's
`test/setup.ts` kill-switches (`NO_AUTOLAUNCH`, `AI_CONDUCTOR_NO_REAL_EXEC`) and the
`pipeline-leak-guard` must stay satisfied — no writes may leak into the test cwd, and no real
subprocess/daemon may spawn (inject/mocked seams only).

Each story is executed **confirm-then-fill**: the first task in each group inspects the existing
test file for prior coverage; only genuinely-missing assertions are added, so we never duplicate.
Sequencing is by story, cheapest/most-isolated first (parsers and scanner), then the
orchestration-level and signal tasks that need spy/inject scaffolding, then the setup commit-scope
investigation (which may end in a documented finding rather than a test), and finally a full-suite
green run. The bash file deletion is **out of scope** — it is deferred to cutover PR #226.

## Prerequisites
- Node deps installed in `src/conductor` (each worktree needs its own `npm install`).
- Familiarity with existing patterns: `test/engine/worktree.test.ts` (mkdtemp fixtures),
  `test/engine/conductor.test.ts` (SIGINT `process.on`/`process.exit` spy),
  `test/engine/task-progress.test.ts`, `test/engine/step-runners.test.ts`,
  `test/execution/session.test.ts`, `vitest.config.ts`, `test/setup.ts`.

## Tasks

### Task 1: Confirm build_stall handoff is unwitnessed by existing tests
**Story:** Build-loop stall handoff (happy + auto-mode negative)
**Type:** infrastructure
**Steps:**
1. Grep `test/engine/conductor.test.ts` and `test/engine/task-progress.test.ts` for `build_stall`
   / stall handoff assertions; confirm only the `countResolvedTasks` primitive is covered.
2. Note the injection/mock seams `conductor.test.ts` already uses (handoff/REPL, mode flag,
   `countResolvedTasks`).
**Files likely touched:** none (investigation)
**Dependencies:** none

### Task 2: Test build_stall emits `no_task_progress` and hands off (interactive)
**Story:** Build-loop stall handoff — happy path (no_task_progress)
**Type:** happy-path
**Steps:**
1. Write failing test: interactive mode, `countResolvedTasks` returns the same count across a build
   retry → assert a `build_stall` event with `reason: 'no_task_progress'` is emitted and the
   interactive-handoff seam is invoked.
2. Verify RED.
3. No production change expected (wiring exists at `conductor.ts` ~L1354) — GREEN via correct
   mock wiring.
4. Verify GREEN.
5. Commit: "test(conductor): pin build_stall no_task_progress handoff".
**Files likely touched:**
- `src/conductor/test/engine/conductor.test.ts` — add stall-handoff describe block
**Dependencies:** Task 1

### Task 3: Test build_stall emits `halt_marker` reason
**Story:** Build-loop stall handoff — happy path (halt_marker)
**Type:** happy-path
**Steps:**
1. Write failing test: a halt marker present during build → assert `build_stall` event with
   `reason: 'halt_marker'` and handoff invoked.
2. RED → GREEN → verify.
3. Commit: "test(conductor): pin build_stall halt_marker handoff".
**Files likely touched:**
- `src/conductor/test/engine/conductor.test.ts`
**Dependencies:** Task 2

### Task 4: Test auto-mode skips the stall handoff
**Story:** Build-loop stall handoff — negative path (auto mode)
**Type:** negative-path
**Steps:**
1. Write failing test: same `no_task_progress` stall condition but auto mode → assert the
   interactive-handoff seam is NOT invoked and no REPL spawns.
2. RED → GREEN → verify.
3. Commit: "test(conductor): auto-mode skips build_stall handoff".
**Files likely touched:**
- `src/conductor/test/engine/conductor.test.ts`
**Dependencies:** Task 3

### Task 5: Test scan skips a corrupt conduct-state.json and keeps valid worktrees
**Story:** Resume scanner robustness — happy + negative
**Type:** negative-path
**Steps:**
1. Write failing test: mkdtemp git repo, two `.worktrees/*` dirs — one valid
   `conduct-state.json`, one with unparseable JSON → assert `WorktreeManager.scan` returns only the
   valid entry and does not throw.
2. Verify RED (if scan currently throws) or confirm behavior already correct; if a code fix is
   needed in `src/engine/worktree.ts`, implement the try/catch skip.
3. Verify GREEN.
4. Commit: "test(worktree): scan skips corrupt conduct-state.json".
**Files likely touched:**
- `src/conductor/test/engine/worktree.test.ts` — new scan case
- `src/conductor/src/engine/worktree.ts` — only if scan does not already swallow parse errors
**Dependencies:** none

### Task 6: Confirm current signal coverage and decide parity scope
**Story:** Termination signals — design decision
**Type:** infrastructure
**Steps:**
1. Read `conductor.ts` ~L863 signal registration and confirm only `SIGINT` is registered.
2. Decide: extend to SIGTERM/SIGHUP for bash parity (preferred) OR document SIGINT-only.
3. Record the decision inline in the plan/story (a one-line note) so BUILD does not re-litigate.
**Files likely touched:** none (investigation/decision)
**Dependencies:** none

### Task 7: Extend signal handler to SIGTERM/SIGHUP (or assert SIGINT-only by design)
**Story:** Termination signals — happy paths
**Type:** happy-path
**Steps:**
1. Write failing test (SIGINT baseline stays green): spy `process.on`/`process.exit`; trigger
   handler → assert state flushed + `exit(130)`. If extending, register `SIGTERM`/`SIGHUP` on the
   same handler and add assertions for each.
2. RED → implement handler extension in `conductor.ts` (if that branch chosen) → GREEN.
3. If SIGINT-only chosen instead: add an explicit assertion/comment recording the design and its
   rationale — no signal left silently divergent.
4. Commit: "feat(conductor): flush state + exit 130 on SIGTERM/SIGHUP (bash parity)" or
   "test(conductor): document SIGINT-only signal handling".
**Files likely touched:**
- `src/conductor/test/engine/conductor.test.ts`
- `src/conductor/src/engine/conductor.ts` — only if extending signals
**Dependencies:** Task 6

### Task 8: Test signal handler de-registration on normal loop exit
**Story:** Termination signals — negative path (handler leak)
**Type:** negative-path
**Steps:**
1. Write failing test: spy `process.off`; run loop to normal completion → assert the handler is
   de-registered (no cross-run accumulation).
2. RED → GREEN → verify.
3. Commit: "test(conductor): signal handler removed on normal exit".
**Files likely touched:**
- `src/conductor/test/engine/conductor.test.ts`
**Dependencies:** Task 7

### Task 9: Confirm planHasDependencyTree is untested
**Story:** Plan dependency parsing — infrastructure
**Type:** infrastructure
**Steps:**
1. Grep `test/` for `planHasDependencyTree`; confirm no existing coverage.
2. Locate the export in `src/engine/artifacts.ts` and note its signature/return contract.
**Files likely touched:** none (investigation)
**Dependencies:** none

### Task 10: Test planHasDependencyTree true/false on real plan fixtures
**Story:** Plan dependency parsing — happy + negative
**Type:** happy-path
**Steps:**
1. Write failing test: plan markdown with `### Task 2` declaring a dependency on Task 1 →
   `planHasDependencyTree` returns `true`; a plan with no dependency declarations → `false`.
2. RED → GREEN (behavior exists) → verify.
3. Commit: "test(artifacts): pin planHasDependencyTree detection".
**Files likely touched:**
- `src/conductor/test/engine/artifacts.test.ts` — new describe block
**Dependencies:** Task 9

### Task 11: Test planHasDependencyTree on empty/absent content
**Story:** Plan dependency parsing — negative path (empty/null)
**Type:** negative-path
**Steps:**
1. Write failing test: `''` and `null`/absent content → returns `false` (or documented sentinel)
   without throwing.
2. RED → GREEN → verify.
3. Commit: "test(artifacts): planHasDependencyTree safe on empty input".
**Files likely touched:**
- `src/conductor/test/engine/artifacts.test.ts`
**Dependencies:** Task 10

### Task 12: Confirm + fill cooldown escalation tier boundaries
**Story:** Rate-limit cooldown escalation — happy path
**Type:** happy-path
**Steps:**
1. Read `test/engine/step-runners.test.ts` and `test/execution/session.test.ts`; identify which of
   1x (`<10`), 2x (`10-19`), 3x (`>=20`) and the per-call increment are already asserted.
2. Write failing test(s) only for the unasserted boundaries, including exact `callCount == 10` and
   `callCount == 20` boundary assertions against `getCooldownSeconds` / the step-runner multiplier.
3. RED → GREEN → verify. If fully covered already, record that finding and add nothing.
4. Commit: "test(session): pin cooldown multiplier tier boundaries".
**Files likely touched:**
- `src/conductor/test/execution/session.test.ts` and/or `test/engine/step-runners.test.ts`
**Dependencies:** none

### Task 13: Test cooldown disabled + first-step-skip negatives
**Story:** Rate-limit cooldown escalation — negative paths
**Type:** negative-path
**Steps:**
1. Write failing test: `stepCooldown == 0` → no delay regardless of `callCount`; first step
   (`callCount == 0`) → no cooldown before first call.
2. RED → GREEN → verify.
3. Commit: "test(session): cooldown disabled + first-step skip".
**Files likely touched:**
- `src/conductor/test/execution/session.test.ts` and/or `test/engine/step-runners.test.ts`
**Dependencies:** Task 12

### Task 14: Locate + test setup commit-scope (or record parity-gap finding)
**Story:** Pre-worktree setup commit-scope — happy + negatives
**Type:** happy-path
**Steps:**
1. Locate the TS pre-worktree commit path (search setup/conductor/worktree-prepare flow for the
   project-level `git add`/commit equivalent of bash `run_worktree_setup`). Name file + symbol.
2. If it exists: write failing test on a mkdtemp fixture containing BOTH project-level
   (`.memory/`, `.docs/decisions/`) and per-feature (`.docs/specs|stories|plans`) files → assert
   only project-level paths are staged and per-feature `.docs` are excluded (no wholesale add).
   RED → GREEN → verify.
3. If NO such commit step exists in the TS port: record an explicit parity-gap finding at the top of
   this plan (a `## Parity Finding` note) so it is not silently dropped, and close the story against
   that finding.
4. Commit: "test(setup): pin project-level-only commit scope" or
   "docs(plan): record setup commit-scope parity gap".
**Files likely touched:**
- Wherever the commit path lives, or a new `test/engine/*.test.ts`
- This plan file (if recording a finding)
**Dependencies:** none

### Task 15: Run the full vitest suite and confirm green
**Story:** All (regression gate)
**Type:** infrastructure
**Steps:**
1. From `src/conductor`, run `rtk proxy npx vitest run`.
2. Confirm the whole suite is green (new tests included) and the pipeline-leak guard did not trip.
3. If any leak/failure, fix before closing.
4. Commit: "test: port bash worktree coverage — full suite green".
**Files likely touched:** none (verification)
**Dependencies:** Tasks 2-14

## Task Dependency Graph
```
Task 1 → Task 2 → Task 3 → Task 4  (build_stall group)
Task 5                              (scanner — independent)
Task 6 → Task 7 → Task 8           (signals group)
Task 9 → Task 10 → Task 11         (plan-deps group)
Task 12 → Task 13                  (cooldown group)
Task 14                            (setup commit-scope — independent)
[Tasks 2-14] → Task 15             (full-suite green gate)
```

## Integration Points
- After Task 4: build-stall orchestration behavior is pinned independent of the primitive.
- After Task 8: conductor signal/termination behavior is fully pinned.
- After Task 15: the six bash-pinned behaviors are covered by black-box TS tests; cutover PR #226
  can safely delete `test/test_conduct_worktree.sh`.

## Verification
- [ ] All happy-path criteria covered by at least one task
- [ ] All negative-path criteria covered by at least one task (Tasks 4, 5, 8, 11, 13, 14)
- [ ] No task exceeds ~5 minutes of focused work
- [ ] Dependencies are explicit and acyclic
- [ ] All new tests are black-box (drive real `src/engine/` exports; no source grepping)
- [ ] Kill-switches (`NO_AUTOLAUNCH`, `AI_CONDUCTOR_NO_REAL_EXEC`) and pipeline-leak guard respected
- [ ] Bash file deletion left to cutover PR #226 (not in this spec)
```
