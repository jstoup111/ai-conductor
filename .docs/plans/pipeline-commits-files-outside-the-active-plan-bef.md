# Implementation Plan: Plan-scope containment at the commit boundary

**Date:** 2026-08-02
**Design:** `.docs/decisions/adr-2026-08-02-plan-scope-containment-at-commit-boundary.md`
**Review:** `.docs/decisions/architecture-review-pipeline-commits-files-outside-the-active-plan-bef.md`
**Architecture:** `.docs/architecture/pipeline-commits-files-outside-the-active-plan-bef.md`
**Stories:** `.docs/stories/pipeline-commits-files-outside-the-active-plan-bef.md`
**Complexity:** `.docs/complexity/pipeline-commits-files-outside-the-active-plan-bef.md`
**Conflict check:** Clean as of 2026-08-02, including open GitHub issues (one HIGH interaction, C1, mitigated by Tasks 6 and 8)
**Issue:** #1227

## Amendments

**Amendment 1 — 2026-08-07, operator-authorized (DECIDE-owned).** This plan corrects Task 14's
release-artifact instructions, recorded below, and authorizes the diff that reverts the work the
original instructions forced.

As authored, Task 14 step 3 said "Add a `CHANGELOG.md` `[Unreleased]` entry and a `## Migration`
section with a runnable ```bash migration``` block", and listed `CHANGELOG.md` in its Files. Both
contradict this repository's release gates, which the plan did not consult:

- CLAUDE.md, Release & Update Gates preamble: "Implementation branches never write `CHANGELOG.md`
  or `VERSION`." `CHANGELOG.md`'s own header repeats this.
- CLAUDE.md, Release gate 2: "Migration blocks for breaking changes travel in the **PR body**, not
  `CHANGELOG.md`" — inside a `## Migration` section of the PR body.

The instruction was unsatisfiable as written. A runnable migration block under `[Unreleased]` is
rejected by integrity check 19 by design, because `bin/migrate` drops that section before semver
selection (`bin/migrate:418`), so no consumer would ever run it; and a non-empty `[Unreleased]`
makes the bot-owned release-PR renderer throw (`release-renderer.ts:151-157`). Following the plan
therefore produced an inert migration and an out-of-plan widening of check 19 to make the invalid
placement pass.

**Corrected Task 14.** Step 3 updates `docs/reference/settings-and-hooks.md`,
`docs/explanation/gates.md`, and `docs/reference/cli.md` only. It does **not** touch `CHANGELOG.md`
or `VERSION`. The mandatory migration block (architecture-review F4) is a PR-body artifact authored
at publication, not a file on this branch; the waiver path still does not apply. Task 14's Files
list drops the `CHANGELOG.md` line.

**Authorized revert.** This plan authorizes reverting, to their `main` state, the four files the
original instruction forced out of plan scope: `CHANGELOG.md`,
`test/check_migration_block_authoring.sh`, `test/test_migration_block_authoring.sh`, and
`docs/contributing/validation.md`. Integrity check 19's contract is restored unchanged — it is the
gate that caught this and must not be weakened.

## Summary

A 14-task plan adding deterministic plan-scope containment at the git commit boundary, a
`Scope:` commit-trailer escape hatch, and an engine-side backstop. All matching logic lives in
one new TypeScript module reusing existing primitives; the `commit-msg` hook calls into it
rather than re-implementing anything in shell. The hook ships report-only; enforcement is a
follow-up flip earned on live data (architecture-review F6).

## Technical Approach

- One new pure module, `plan-scope-containment.ts`, owns the containment decision. It takes
  staged paths, a resolved task row, and the commit's `Scope:` trailers, and returns a verdict.
  Pure and fully unit-testable with no git or filesystem access.
- A thin CLI entry point (`conduct-ts scope-check`) exposes it to the hook so the shell never
  parses markdown or implements path matching. Its exit contract is three-valued — `0` allowed,
  `2` violation, anything else abstain — because `COMMIT_MSG_HOOK` runs under `set -e` and a
  two-valued contract would turn a stale `dist` into a fail-closed wedge (F2).
- `seedTaskStatus` gains a `files` field per row, sourced from `parsePlanTaskPaths` but written
  **only** for task sections carrying an explicit `**Files:**` line — never from the parser's
  prose-bullet fallback, whose incidental paths would otherwise become blocking scope (F5 risk
  table, #548 class).
- The dead bundling block in `COMMIT_MSG_HOOK` is replaced by a call to that CLI.
- The engine backstop lands beside the existing per-task coverage floor, reusing its
  fail-soft report shape, and additionally records accepted `Scope:` widenings so they reach
  `build_review` — whose inputs carry a diff, not the commit log.
- Every abstention condition from architecture-review F2 is an individually named test.

## Prerequisites

- None. All dependencies are in-repo and already in production use.

## Tasks

### Task 1: Seed plan-declared paths onto task rows

**Story:** TI-1
**Type:** happy-path

**Steps:**
1. Write failing tests: seeding a plan whose Task 3 declares two paths produces a row with
   `files` containing exactly those, and a `same as Task 1` task inherits Task 1's set.
2. Verify RED.
3. Expose per-section declaration provenance from `parsePlanTaskPaths` — it currently computes
   `hasFilesLine` and discards it — either as an additional return field or a declared-only
   variant beside it. Existing callers keep their current behavior unchanged.
4. In `seedTaskStatus`, call it and write `files: [...paths]` onto each seeded row **whose
   section carried an explicit `**Files:**` line**. `TaskStatusRecord` already carries an open
   index signature.
5. Verify GREEN.
6. Commit `feat(engine): seed plan-declared paths onto task rows`.

**Files:**
- `src/conductor/src/engine/plan-task-parse.ts` — expose declaration provenance
- `src/conductor/src/engine/task-seed.ts` — populate `files` per row
- `src/conductor/test/engine/plan-task-parse.test.ts` — provenance tests
- `src/conductor/test/engine/task-seed.test.ts` — seeding tests

**Wired-into:** `src/conductor/src/engine/task-seed.ts#seedTaskStatus`
**Dependencies:** none

### Task 2: Preserve existing row state when adding `files`

**Story:** TI-1
**Type:** negative-path

**Steps:**
1. Add failing tests: re-seeding preserves `in_progress` and terminal statuses and all other
   existing fields; `**Files:** none` yields an empty array rather than an absent field or a
   wildcard; a plan with no `Files:` block anywhere seeds rows with no `files` and does not throw;
   a section with no `**Files:**` line but with backticked path bullets — the prose fallback —
   seeds NO `files`, so its incidental paths can never block a commit (#548 class).
2. Verify RED.
3. Adjust the merge path so `files` is additive and never clobbers preserved rows.
4. Verify GREEN.
5. Commit `fix(engine): keep task-row state intact when seeding declared paths`.

**Files:**
- `src/conductor/src/engine/task-seed.ts` — merge guards
- `src/conductor/test/engine/task-seed.test.ts` — preservation and edge-case tests

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Containment decision module — core rule

**Story:** TI-2
**Type:** happy-path

**Steps:**
1. Write failing unit tests for a pure `evaluateScopeContainment(...)`: all staged paths
   inside the declared set returns allowed; an undeclared path returns a violation carrying
   the task id and only the offending paths; suffix matching accepts
   `src/conductor/src/engine/config.ts` against a declared `engine/config.ts`.
2. Verify RED.
3. Implement the module, delegating per-path matching to `fileMatchesPlanPath`.
4. Verify GREEN.
5. Commit `feat(engine): add plan-scope containment evaluator`.

**Files:**
- `src/conductor/src/engine/plan-scope-containment.ts` — pure evaluator
- `src/conductor/test/engine/plan-scope-containment.test.ts` — core rule tests

**Wired-into:** `src/conductor/src/engine/scope-check-cli.ts#runScopeCheck`
**Dependencies:** none

### Task 4: Containment evaluator — over-acceptance and allowlist negatives

**Story:** TI-2
**Type:** negative-path

**Steps:**
1. Add failing tests: a declared `trail.ts` must NOT match staged `audit-trail.ts`; staged
   paths under `.pipeline/` or `.docs/shipped/` never count as violations; a mixed diff of a
   declared path plus a machinery path is allowed.
2. Verify RED.
3. Apply `MACHINERY_AUTHORED_PATHS` as the standing allowlist; confirm segment-anchored
   matching.
4. Verify GREEN.
5. Commit `fix(engine): anchor scope matching and exempt machinery paths`.

**Files:**
- `src/conductor/src/engine/plan-scope-containment.ts` — allowlist and matching guards
- `src/conductor/test/engine/plan-scope-containment.test.ts` — over-acceptance tests

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 5: Containment evaluator — abstention matrix

**Story:** TI-3
**Type:** negative-path

**Steps:**
1. Add failing table tests, one case per architecture-review F2 condition: no task declares a
   `Files:` block anywhere; no row for the stamped id; row with absent `files`; row with empty
   `files`; no task id supplied; and a stamped row whose status is not `in_progress` (a stale
   `.pipeline/current-task` yields a well-formed but wrong trailer, which would otherwise judge
   correct work against a previous task's declared set).
2. Verify RED.
3. Implement abstention so the evaluator returns allowed for every one; it blocks only on
   positive evidence.
4. Verify GREEN.
5. Commit `fix(engine): abstain from scope containment on absent evidence`.

**Files:**
- `src/conductor/src/engine/plan-scope-containment.ts` — abstention rules
- `src/conductor/test/engine/plan-scope-containment.test.ts` — abstention matrix

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 6: `Scope:` trailer parser

**Story:** TI-4
**Type:** happy-path

**Steps:**
1. Write failing tests for parsing `Scope: <path> — <rationale>` trailers out of a commit
   message: a well-formed trailer yields `{path, rationale}`; the trailer is repeatable and
   multiple occurrences parse independently; both `—` and `-` separate path from rationale.
2. Verify RED.
3. Implement the parser and wire trailers into the evaluator as a widening of the allowed set
   for this commit only — never a standing widening for the task.
4. Verify GREEN.
5. Commit `feat(engine): parse Scope: commit trailers`.

**Files:**
- `src/conductor/src/engine/scope-trailer.ts` — parser
- `src/conductor/src/engine/plan-scope-containment.ts` — apply widening
- `src/conductor/test/engine/scope-trailer.test.ts` — parser tests

**Wired-into:** `src/conductor/src/engine/plan-scope-containment.ts#evaluateScopeContainment`
**Dependencies:** Task 3

### Task 7: `Scope:` trailer — fail-closed on malformed input

**Story:** TI-4
**Type:** negative-path

**Steps:**
1. Add failing tests: a path not present in the staged set, a missing or empty rationale, and a
   bare `Scope:` with no path are each treated as absent, never as blanket permission; a diff
   containing a trailered path `A` plus an undeclared `B` is refused naming `B` only; a widening
   accepted on one commit does not carry to the next commit staging the same path.
2. Verify RED.
3. Harden the parser and the widening application.
4. Verify GREEN.
5. Commit `fix(engine): treat malformed Scope: trailers as absent`.

**Files:**
- `src/conductor/src/engine/scope-trailer.ts` — validation
- `src/conductor/test/engine/scope-trailer.test.ts` — malformed-input matrix

**Wired-into:** same as Task 6
**Dependencies:** Task 6

### Task 8: `scope-check` CLI entry point with an actionable refusal message

**Story:** TI-2
**Type:** infrastructure

**Steps:**
1. Write failing tests: the CLI reads staged paths, task id, `task-status.json`, and the commit
   message's `Scope:` trailers; it exits `0` when allowed and `2` on violation, and every other
   exit code means abstain. The violation message names the task id, every offending path, the
   exact `Scope: <path> — <rationale>` line to add per path, and never instructs deletion
   (conflict-check C1 mitigations 1 and 2).
2. Verify RED.
3. Implement `runScopeCheck` and register `detectScopeCheckCommand` in the CLI dispatcher.
4. Verify GREEN.
5. Commit `feat(cli): add conduct-ts scope-check`.

**Files:**
- `src/conductor/src/engine/scope-check-cli.ts` — CLI entry point and message rendering
- `src/conductor/src/index.ts` — export/register the command
- `src/conductor/test/engine/scope-check-cli.test.ts` — exit-code and message tests

**Wired-into:** `src/conductor/src/index.ts`, `src/conductor/src/engine/git-hook-assets.ts#COMMIT_MSG_HOOK`
**Dependencies:** Task 5, Task 7

### Task 9: Replace the dead bundling block in the commit-msg hook

**Story:** TI-2
**Type:** infrastructure

**Steps:**
1. Write failing structural tests over `COMMIT_MSG_HOOK`: the `tasksByFile` bundling block is
   gone; the hook invokes `scope-check`; a non-zero result exits 1.
2. Verify RED.
3. Replace lines 180-222 of the asset with the `scope-check` invocation inside the existing
   guarded block, so all current exemptions are inherited unchanged.
4. Verify GREEN.
5. Commit `feat(hooks): enforce plan-scope containment in commit-msg`.

**Files:**
- `src/conductor/src/engine/git-hook-assets.ts` — replace the dead block
- `src/conductor/test/engine/git-hook-assets.test.ts` — structural tests

**Wired-into:** `src/conductor/src/engine/worktree-prepare.ts#writeGitHooks`
**Dependencies:** Task 8

### Task 10: Hook-level exemptions and fail-open behavior

**Story:** TI-3
**Type:** negative-path

**Steps:**
1. Write failing tests in a temp git repo: merge commit, `--amend`, rebase replay,
   `CONDUCT_ENGINE_COMMIT=1`, and a commit with no `Task:` trailer each succeed with staged
   paths outside the declared set; an unavailable, unregistered, or throwing `scope-check`
   exits 0 with a stderr diagnostic; a check exiting `1` or `127` allows the commit while a
   check exiting `2` refuses it.
2. Verify RED.
3. Ensure the invocation sits inside the guarded block, that the exit status is captured
   (`|| rc=$?`) so `set -e` at `git-hook-assets.ts:92` cannot convert an abstention into a
   refusal, and that only `2` blocks.
4. Verify GREEN.
5. Commit `fix(hooks): preserve exemptions and fail open on scope-check failure`.

**Files:**
- `src/conductor/src/engine/git-hook-assets.ts` — guard placement and fail-open branch
- `src/conductor/test/engine/git-hook-assets.test.ts` — exemption and fail-open tests

**Wired-into:** same as Task 9
**Dependencies:** Task 9

### Task 11: Report-only mode as the shipped default

**Story:** TI-7
**Type:** infrastructure

**Steps:**
1. Write failing tests: in report-only mode a violation prints the full refusal message and the
   hook exits 0; in enforcing mode the same input refuses; an abstention prints nothing in
   either mode; the shipped default is report-only.
2. Verify RED.
3. Implement the mode as a single config-resolved flag read by the hook, defaulting to
   report-only per architecture-review F6. Enforcement is a follow-up one-line flip once
   `.pipeline/containment-floor.json` from real builds shows the refusal rate this design
   assumes.
4. Verify GREEN.
5. Commit `feat(hooks): ship plan-scope containment report-only`.

**Files:**
- `src/conductor/src/engine/scope-check-cli.ts` — mode resolution and reporting branch
- `src/conductor/src/engine/git-hook-assets.ts` — honor report-only
- `src/conductor/test/engine/scope-check-cli.test.ts` — mode tests

**Wired-into:** `src/conductor/src/engine/git-hook-assets.ts#COMMIT_MSG_HOOK`
**Dependencies:** Task 10

### Task 12: Engine-side containment backstop

**Story:** TI-5
**Type:** happy-path

**Steps:**
1. Write failing tests: branch commits inside declared paths report satisfied; a commit
   stamped `Task: 3` touching an undeclared path reports a violation with task id, sha, and
   path; a path covered by a `Scope:` trailer on that same commit reports satisfied; every
   accepted widening is recorded with its path, rationale, task id, and sha, and that record is
   supplied as a `build_review` input — the grader receives a diff, not the commit log, so this
   is the only way a widening reaches review.
2. Verify RED.
3. Implement `runContainmentFloor` beside the coverage floor, reusing `filesForCommit` and the
   Task 3 evaluator, and write `.pipeline/containment-floor.json`.
4. Verify GREEN.
5. Commit `feat(engine): add plan-scope containment floor`.

**Files:**
- `src/conductor/src/engine/per-task-commit-floor.ts` — containment floor
- `src/conductor/test/engine/per-task-commit-floor.test.ts` — floor tests

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runBuildReview`
**Dependencies:** Task 6

### Task 13: Backstop fail-soft and exempt-commit handling

**Story:** TI-5
**Type:** negative-path

**Steps:**
1. Add failing tests: unreadable plan, git failure, and malformed input each degrade to
   satisfied with a skip note; merge, rebase-replay, and `CONDUCT_ENGINE_COMMIT=1` commits are
   not reported as violations.
2. Verify RED.
3. Wrap the floor fail-soft and filter exempt commits; wire the call into `runBuildReview`
   alongside the existing floor.
4. Verify GREEN.
5. Commit `fix(engine): make the containment floor fail-soft`.

**Files:**
- `src/conductor/src/engine/per-task-commit-floor.ts` — fail-soft and exemption filtering
- `src/conductor/src/engine/step-runners.ts` — invoke the floor
- `src/conductor/test/engine/per-task-commit-floor.test.ts` — fail-soft tests

**Wired-into:** same as Task 12
**Dependencies:** Task 12

### Task 14: #1074 regression acceptance test, docs, and migration

**Story:** TI-6
**Type:** happy-path

**Steps:**
1. Write a failing acceptance test reproducing the #1074 shape: a config-only plan, then a
   staged commit changing `artifacts.ts` and `changelog-pr-finalizer-cli.ts`, asserting — with
   enforcement enabled — deterministic refusal naming the task id and both paths, that no file
   is deleted, that the same commit is accepted once each path carries a `Scope:` trailer, and
   that a commit changing only `config.ts` is accepted.
2. Verify RED.
3. Update `docs/reference/settings-and-hooks.md` (commit-msg containment behavior and the
   report-only default), `docs/explanation/gates.md` (the new gate and the `Scope:` trailer
   contract), and `docs/reference/cli.md` (`conduct-ts scope-check` and its three-valued exit
   codes). Do not touch `CHANGELOG.md` or `VERSION` — implementation branches never write
   either. The runnable ```bash migration``` block that re-wires git hooks in existing
   worktrees is still mandatory (architecture-review F4; the waiver path does not apply because
   this changes real hook behavior), but it belongs in the `## Migration` section of the **PR
   body**, authored at publication — not in any file on this branch (Amendment 1).
4. Verify GREEN and run `test/test_harness_integrity.sh`.
5. Commit `test(engine): reproduce #1074 out-of-scope commit rejection`.

**Files:**
- `src/conductor/test/acceptance/plan-scope-containment.acceptance.test.ts` — regression test
- `docs/reference/settings-and-hooks.md` — hook behavior
- `docs/explanation/gates.md` — gate and `Scope:` trailer contract
- `docs/reference/cli.md` — `scope-check`

**Wired-into:** none (test and documentation only)
**Dependencies:** Task 10, Task 11, Task 13

## Task Dependency Graph

```
Task 1 (seed files)
  └── Task 2 (preserve row state)

Task 3 (containment evaluator)
  ├── Task 4 (matching + allowlist negatives)
  ├── Task 5 (abstention matrix)
  └── Task 6 (Scope: trailer parser)
        ├── Task 7 (malformed trailers)
        └── Task 12 (containment floor + widening record)
              └── Task 13 (floor fail-soft)

Task 5, Task 7
  └── Task 8 (scope-check CLI, three-valued exit)
        └── Task 9 (replace dead hook block)
              └── Task 10 (exemptions + fail-open)
                    └── Task 11 (report-only default)

Task 11, Task 13
  └── Task 14 (regression test, docs, migration)
```

Tasks 1-2 and 3 are independent roots and may run in parallel.

## Validation

- `test/test_harness_integrity.sh` must pass before any commit (repository rule).
- No `VERSION` or `CHANGELOG.md` edit — implementation branches never write either
  (Amendment 1).
- The migration block is mandatory (architecture-review F4); a release waiver is not
  acceptable for this change. It travels in the PR body's `## Migration` section.
