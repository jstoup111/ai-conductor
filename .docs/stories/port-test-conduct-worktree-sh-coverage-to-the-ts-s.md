**Status:** Accepted

# Stories: Port test_conduct_worktree.sh coverage to the TS suite

Technical track, Small tier. These stories port the **genuine coverage gaps** from the 925-line
whitebox bash test `test/test_conduct_worktree.sh` into the conductor vitest suite as **black-box**
tests that drive the real `src/engine/` modules. An audit established that ~two-thirds of the bash
assertions grep the `bin/conduct` source itself (being removed in cutover PR #226 — **not** ported)
and that most behaviors already have vitest coverage (worktree create/scan/cleanup,
`stepDone`/`stepSatisfied`, state read/write, `countResolvedTasks`, SIGINT save, build-failure
escalation, `parseTrack`, `parseComplexityTier`, `parseIntakeSourceRef`, `isStoriesApproved`). Only
the six behaviors below remain uncovered.

**Cross-cutting constraints (apply to every story):**
- Every test is **black-box** — it drives the real exported `src/engine/` function against fixtures
  and asserts observable output/state/events. **No grepping of source text.**
- Tests MUST honor the suite kill-switches (`NO_AUTOLAUNCH`, `AI_CONDUCTOR_NO_REAL_EXEC`) and the
  pipeline-leak guard: no writes may leak into the test cwd. Use `mkdtemp` fixture repos in
  `beforeEach`, mirroring `test/engine/worktree.test.ts`.
- Each story is framed **confirm-then-fill**: first verify no existing test already covers the
  behavior; add the black-box test only for the genuinely uncovered part. Never duplicate coverage.
- The bash file itself is **deleted by the cutover PR (#226), not by this spec** — this spec only
  adds the parity tests.

---

## Story: Build-loop stall handoff is wired to interactive (and skipped in auto mode)

**Requirement:** Parity with bash Test 17 (run_build conductor-owned loop — stall behavior)

As a harness maintainer, I want the conductor's build-stall detection to hand off to an interactive
session when task progress halts, so that a stuck build surfaces to a human instead of retrying
forever — while auto mode (no human present) skips the handoff.

### Acceptance Criteria

#### Happy Path
- Given a build step under interactive mode whose `countResolvedTasks` returns the **same** count
  before and after a build retry, when the conductor evaluates progress at `conductor.ts` (~L1354),
  then it sets the stall reason to `no_task_progress`, emits a `build_stall` event carrying that
  reason, and hands off to the interactive REPL rather than silently retrying.
- Given a build step where a **halt marker** is present, when the conductor evaluates progress, then
  it sets the stall reason to `halt_marker`, emits a `build_stall` event with that reason, and hands
  off to interactive.
- Given the interactive REPL exits after a stall handoff, when control returns to the loop, then the
  conductor **re-checks** progress rather than assuming the stall is resolved.

#### Negative Paths
- Given the identical stall condition (`no_task_progress`) but the run is in **auto mode**, when the
  conductor evaluates progress, then the interactive handoff is **skipped** (there is no human to
  break the stall) and no interactive REPL is spawned — asserted via the injected/mocked handoff
  seam, not by real process spawn.

### Done When
- [ ] A vitest test drives the real conductor build-step path (with a mocked/injected
      `countResolvedTasks` and handoff seam) and asserts a `build_stall` event with
      `reason: 'no_task_progress'` is emitted when the count does not advance between retries.
- [ ] A separate assertion covers `reason: 'halt_marker'` when a halt marker is present.
- [ ] An auto-mode test asserts the handoff seam is **not** invoked under the same stall condition.
- [ ] Test confirms it is exercising the orchestration wiring, distinct from the already-tested
      `countResolvedTasks` primitive in `test/engine/task-progress.test.ts`.
- [ ] No real subprocess/daemon spawns (kill-switches respected); no `.pipeline/` leak into cwd.

---

## Story: Resume scanner skips a corrupt conduct-state.json and keeps listing valid worktrees

**Requirement:** Parity with bash Test 3 (scanner edge cases — corrupt JSON)

As a harness maintainer, I want `WorktreeManager.scan` to tolerate a malformed
`.worktrees/*/.pipeline/conduct-state.json`, so that one corrupt worktree state cannot crash the
resume menu or hide the other resumable features.

### Acceptance Criteria

#### Happy Path
- Given a `.worktrees/` directory containing one worktree with **valid** `conduct-state.json` and
  one whose `conduct-state.json` is **unparseable JSON**, when `WorktreeManager.scan` runs, then it
  returns exactly the valid worktree (correct `feature_desc`/step/status) and does **not** throw.

#### Negative Paths
- Given a `.worktrees/` entry whose `conduct-state.json` is unparseable JSON, when `scan` processes
  it, then that entry is silently skipped (swallowed parse error) rather than propagating an
  exception that aborts the whole scan.

### Done When
- [ ] A vitest fixture (mkdtemp git repo) creates two worktree dirs — one valid state file, one with
      deliberately malformed JSON — and asserts `scan()` returns only the valid entry.
- [ ] Test asserts `scan()` does not throw on the corrupt entry.
- [ ] Confirms the existing `worktree.test.ts` scan coverage only exercised corrupted `.git` /
      deleted branch, so this corrupt-`conduct-state.json` case is genuinely new.
- [ ] No writes leak outside the mkdtemp fixture.

---

## Story: Termination signals flush state and exit 130 (INT/TERM/HUP parity)

**Requirement:** Parity with bash Test 6 (trap INT TERM HUP → cleanup_and_exit)

As a harness maintainer, I want the conductor to persist state and exit with code 130 on the same
termination signals the bash conductor trapped (INT, TERM, HUP), so that a killed or hung-up run is
resumable rather than losing progress. `conductor.ts` currently registers only `SIGINT`.

### Acceptance Criteria

#### Happy Path
- Given a run mid-step with the signal handler registered, when `SIGINT` fires, then state is
  flushed to `conduct-state.json` before `process.exit(130)` (this is the already-existing behavior —
  keep it green).
- Given the parity decision is to extend coverage, when `SIGTERM` fires, then state is flushed and
  the process exits 130 — the same handler behavior as SIGINT.
- Given `SIGHUP` fires, then state is flushed and the process exits 130.

#### Negative Paths
- Given the maintainer decides **not** to trap SIGTERM/SIGHUP (documented design choice), when that
  decision is made, then the story is satisfied instead by an explicit assertion/comment recording
  that only SIGINT is trapped by design, and the rationale is captured — the behavior must not be
  left ambiguous or silently divergent from the bash file it replaces.
- Given a signal handler is registered, when the loop exits normally, then the handler is
  de-registered (`process.off`) so it does not leak across runs (guard against handler accumulation).

> Preference: extend the handler to also cover SIGTERM/SIGHUP for parity, unless implementation
> uncovers a concrete reason SIGINT-only is correct — in which case take the negative-path branch and
> document it.

### Done When
- [ ] A vitest test spies `process.on`/`process.off`/`process.exit`, triggers the handler, and
      asserts state is flushed and `exit(130)` is called — for SIGINT, and (if extended) SIGTERM and
      SIGHUP.
- [ ] If the SIGINT-only design is chosen instead, a test/assertion + rationale explicitly records
      that decision; no signal is left silently unhandled relative to the bash baseline.
- [ ] Handler de-registration on normal exit is asserted (no cross-run handler leak).
- [ ] `process.exit` is stubbed so the test process is not actually killed.

---

## Story: Plan dependency tree is detected from real plan markdown

**Requirement:** Parity with bash Test 16 (extract_task_deps — dependency extraction)

As a harness maintainer, I want `planHasDependencyTree` (`src/engine/artifacts.ts`) covered by a
black-box test, so that the dependency-parsing behavior the bash `extract_task_deps` pinned survives
`bin/conduct` removal.

### Acceptance Criteria

#### Happy Path
- Given a plan whose tasks declare dependencies (e.g. `### Task 2` depends on Task 1), when
  `planHasDependencyTree` reads that plan text, then it returns `true`.

#### Negative Paths
- Given a plan whose tasks declare **no** dependencies (all independent / "none"), when
  `planHasDependencyTree` reads it, then it returns `false`.
- Given empty/absent plan content (`''`/`null`), when `planHasDependencyTree` is called, then it
  returns `false` (or the module's documented not-a-tree sentinel) without throwing.

### Done When
- [ ] A vitest test feeds a real plan-markdown fixture with declared task dependencies and asserts
      `planHasDependencyTree` returns `true`.
- [ ] A fixture with no dependency declarations asserts `false`.
- [ ] An empty/absent-content case asserts `false`/no-throw.
- [ ] Confirms `planHasDependencyTree` had no prior test (new coverage, not a duplicate).

---

## Story: Rate-limit cooldown increments per call and escalates across tiers

**Requirement:** Parity with bash Test 19 (STEP_COOLDOWN / CLAUDE_CALL_COUNT / per-call increment)

As a harness maintainer, I want the per-call cooldown escalation asserted at every tier boundary, so
that the rate-limit backoff the bash conductor configured is provably preserved in the TS port.

### Acceptance Criteria

#### Happy Path
- Given `callCount < 10`, when the inter-step cooldown is computed
  (`step-runners.ts` / `session.getCooldownSeconds`), then the multiplier is `1x` (base cooldown).
- Given `callCount >= 10` and `< 20`, when cooldown is computed, then the multiplier is `2x`.
- Given `callCount >= 20`, when cooldown is computed, then the multiplier is `3x`.
- Given a Claude call completes, when the step runner records it, then `callCount` is incremented by
  one.

#### Negative Paths
- Given `stepCooldown` is `0` (disabled), when cooldown is applied, then no delay is imposed
  regardless of `callCount` (the escalation multiplier does not resurrect a disabled cooldown).
- Given the first step of a run (`callCount == 0`), when cooldown is evaluated, then no cooldown is
  applied before the first call (parity with the bash "skip first step" behavior).

### Done When
- [ ] Review `test/engine/step-runners.test.ts` and `test/execution/session.test.ts`; if any of the
      three multiplier boundaries (`<10`→1x, `10–19`→2x, `>=20`→3x) or the per-call increment is
      **not** already asserted, add the missing assertion(s).
- [ ] The tier boundaries at exactly `callCount == 10` and `callCount == 20` are asserted (boundary,
      not just interior values).
- [ ] The `stepCooldown == 0` disabled case and the first-step skip are asserted.
- [ ] If coverage already fully exists, the story records that finding explicitly (no redundant
      duplicate test added).

---

## Story: Pre-worktree setup commit stages only project-level artifacts

**Requirement:** Parity with bash Test 12 (run_worktree_setup commit scope)

As a harness maintainer, I want the TS setup/commit path proven to stage only project-level
artifacts (`.memory/`, `.docs/decisions/`, `.gitignore`, `.github/`) and never a wholesale add of
per-feature `.docs`, so that the commit-scope isolation the bash `run_worktree_setup` guaranteed is
preserved — or, if no such commit step exists in the TS port, so that absence is recorded rather than
silently lost.

### Acceptance Criteria

#### Happy Path
- Given the TS setup/conductor flow performs a pre-worktree commit, when it stages artifacts, then it
  stages only project-level paths (`.memory/`, `.docs/decisions/`, `.gitignore`, `.github/`) and does
  **not** issue a wholesale `git add` of per-feature `.docs/` (specs/stories/plans).

#### Negative Paths
- Given per-feature `.docs/specs|stories|plans` files are present in the working tree at setup time,
  when the setup commit runs, then those per-feature files are **not** included in the commit (no
  cross-scope bleed into the project-level commit).
- Given the TS port has **no** equivalent pre-worktree project-level commit step, when this story is
  implemented, then that absence is recorded as an explicit written finding in the story/spec (a
  documented parity gap), rather than the behavior being silently dropped.

### Done When
- [ ] The equivalent commit path in the TS setup/conductor flow is located and named (file + symbol).
- [ ] A black-box test drives that commit path against a mkdtemp fixture repo containing both
      project-level and per-feature `.docs` files, and asserts only project-level paths were staged.
- [ ] The per-feature-exclusion negative path is asserted (per-feature `.docs` absent from the
      commit).
- [ ] If no such commit step exists in the TS port, the spec records that as an explicit finding
      (parity gap noted, not silently dropped) and the story is closed against that finding.
