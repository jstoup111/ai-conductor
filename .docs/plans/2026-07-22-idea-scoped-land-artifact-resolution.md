# Implementation Plan: idea-scoped land artifact resolution

**Date:** 2026-07-22
**Design:** technical track — no PRD; approach recorded in `.memory/decisions/2026-07-22-idea-scoped-land-artifact-resolution.md`
**Stories:** .docs/stories/2026-07-22-idea-scoped-land-artifact-resolution.md
**Conflict check:** skipped (Tier S, .docs/complexity/2026-07-22-idea-scoped-land-artifact-resolution.md)

## Summary

Replace `landSpec`'s corpus-wide newest-by-mtime artifact pickers with an
idea-scoped resolver over the files attributable to the per-idea worktree
(`git diff --name-only <base>...HEAD` ∪ untracked), fixing #488's technical-track
false rejections and the latent product-track/track-marker misattribution.
9 tasks, one production file + its test file.

## Technical Approach

- **Attribution set (one git round-trip pair):** in
  `src/conductor/src/engine/engineer/land-spec.ts`, add
  `resolveIdeaFiles(worktreePath, canonicalPath)` which:
  1. derives the base ref via the existing `deriveDefaultBranch(canonicalPath)`
     (same derivation the worktree primitive used at creation),
  2. computes the base commit as `git merge-base HEAD <defaultBranch>` with
     `cwd = worktreePath` (the worktree shares the repo's object store),
  3. unions `git diff --name-only <base> HEAD` (committed-on-branch artifacts,
     e.g. operator-committed annotations) with `?? `-prefixed paths from the
     `git status --porcelain` output landSpec already captures (untracked
     artifacts — the common case),
  4. filters to paths under `.docs/` and returns a `Set<string>` of
     repo-relative paths.
- **Picker replacement:** replace `findNewestFile(dir)` with
  `pickIdeaFile(dir, ideaFiles)`: candidates are `.md` files present in `dir`
  AND in the attribution set; zero candidates → `null` (missing-artifact
  semantics unchanged); multiple candidates → newest mtime *within the idea's
  own files* (mtime survives only as an intra-idea tiebreak, never against
  legacy files). All eight pickers (track, specs, stories, plans, complexity,
  conflicts, architecture, decisions) switch over; the intake-marker
  `planStem` input follows automatically since it takes the picked plan path.
- **Behavioral deltas (all operator-approved):** technical track resolves no
  spec at all; legacy files can no longer satisfy any requirement; a missing
  idea-authored track marker defaults to `product` even when legacy markers
  exist. Every other gate (dirty-worktree, specRequired, stories Accepted,
  tier/artifact consistency, DRAFT-ADR scan, stub/empty content checks) is
  untouched.
- **Sequencing:** helper first (Task 1), wire pickers (Tasks 2–3), then the
  negative-path tasks per story, then delete `findNewestFile` once callerless,
  then CHANGELOG. Tests extend the existing vitest harness in
  `src/conductor/test/engine/engineer/land-spec.test.ts` (temp git repo +
  `createEngineerWorktree` + seeded artifacts; legacy files = committed on
  `main` before worktree creation, decoys made newest via `utimes`).

## Prerequisites

- None — no migrations, no new dependencies. Internal-only change (no
  `bin/conduct` CLI, hook wiring, or settings schema surface), so no
  CHANGELOG migration block; a `[Unreleased] Fixed` entry is required (Task 9).

## Tasks

### Task 1: Add `resolveIdeaFiles` attribution helper
**Story:** TS-2 (attribution universe: committed-on-branch ∪ untracked)
**Type:** infrastructure

**Steps:**
1. Write failing test: seed a repo with a legacy `.docs/plans/legacy.md`
   committed on `main`; create the per-idea worktree; commit one artifact on
   `spec/<slug>` and leave another untracked; assert `resolveIdeaFiles`
   (exported for tests) returns exactly the two idea paths and excludes the
   legacy path.
2. Verify test fails (RED).
3. Implement `resolveIdeaFiles(worktreePath, canonicalPath)` per Technical
   Approach (deriveDefaultBranch → merge-base → diff ∪ untracked → `.docs/`
   filter), plus `pickIdeaFile(dir, ideaFiles)` with intra-idea newest-mtime
   tiebreak.
4. Verify test passes (GREEN).
5. Commit with message: "feat(land-spec): add idea-scoped artifact attribution helper"

**Files:**
- src/conductor/src/engine/engineer/land-spec.ts — add helpers
- src/conductor/test/engine/engineer/land-spec.test.ts — attribution tests

**Wired-into:** none (inert until src/conductor/src/engine/engineer/land-spec.ts)

**Dependencies:** none

### Task 2: Idea-scope the track and spec pickers (kills the #488 false rejection)
**Story:** TS-1 happy paths + mtime regression guard; TS-4 happy path
**Type:** happy-path

**Steps:**
1. Write failing test: technical-track worktree (idea-authored
   `Track: technical` marker) with a legacy spec on `main` containing
   a DRAFT status line, `utimes`-touched to be newest in `.docs/specs/`; assert
   `landSpec` succeeds and the commit tree modifies no legacy spec. Second
   test: idea `Track: technical` marker vs legacy `Track: product` marker
   (any mtime) — assert technical wins.
2. Verify tests fail (RED).
3. Implement: switch the `trackDir` and `specsDir` pickers to
   `pickIdeaFile(..., resolveIdeaFiles(...))`; on the technical track no spec
   is resolved or content-validated.
4. Verify tests pass (GREEN).
5. Commit with message: "fix(land-spec): idea-scope track+spec pickers — legacy DRAFT specs no longer trip technical-track lands (#488)"

**Files:** same as Task 1

**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#landSpec

**Dependencies:** Task 1

### Task 3: Idea-scope the remaining six pickers + intake-marker stem
**Story:** TS-2 happy paths; TS-4 Done-When (planStem)
**Type:** happy-path

**Steps:**
1. Write failing tests: newer-mtime legacy decoys committed on `main` for
   stories, plans, and complexity; assert each picker selects the idea's file
   (stories content validated is the idea's; committed tier is the idea's;
   intake marker stem equals the idea plan's stem, not the legacy plan's).
2. Verify tests fail (RED).
3. Implement: switch stories/plans/complexity/conflicts/architecture/decisions
   pickers to `pickIdeaFile`; `writeIntakeMarker` stem input follows from the
   picked plan.
4. Verify tests pass (GREEN).
5. Commit with message: "fix(land-spec): idea-scope stories/plan/complexity/conflicts/architecture/decisions pickers"

**Files:** same as Task 1

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 4: Negative path — product track with legacy-only specs is rejected
**Story:** TS-3 negative path (+ TS-3 happy: idea PRD beats newer-mtime legacy spec)
**Type:** negative-path

**Steps:**
1. Write failing test: product-track worktree (no idea track marker needed —
   default product) whose `.docs/specs/` holds only legacy specs; assert
   `landSpec` rejects with the missing-artifact error naming
   `spec (product track)`. Companion happy test: idea PRD + newer-mtime legacy
   spec → the idea PRD is the validated/landed file.
2. Verify test fails (RED) if Task 2's implementation missed the requirement
   path; otherwise confirm it passes and keep it as a regression guard.
3. Implement any fix needed so `specRequired` is evaluated against the
   idea-attributable set only.
4. Verify tests pass (GREEN).
5. Commit with message: "test(land-spec): product track rejects legacy-only specs; idea PRD wins over legacy mtime"

**Files:** same as Task 1

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

### Task 5: Negative path — missing idea track marker defaults to product despite legacy markers
**Story:** TS-4 negative path
**Type:** negative-path

**Steps:**
1. Write failing test: worktree with NO idea-authored track marker but a
   legacy `Track: technical` file on `main`; assert the land behaves as
   product track (missing idea-authored spec → `spec (product track)`
   rejection) — the legacy marker cannot loosen the gate.
2. Verify test fails (RED) or stands as a regression guard.
3. Implement any fix needed (track picker returns null → `'product'` default).
4. Verify test passes (GREEN).
5. Commit with message: "test(land-spec): legacy track markers cannot flip the track — missing idea marker defaults to product"

**Files:** same as Task 1

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

### Task 6: Negative path — legacy-only plans dir yields missing-plan rejection
**Story:** TS-2 negative path (legacy file cannot satisfy a requirement)
**Type:** negative-path

**Steps:**
1. Write failing test: worktree whose `.docs/plans/` contains only a legacy
   plan from `main` (idea authored stories/complexity but no plan); assert
   `landSpec` rejects with the missing-artifact error naming `plan`.
2. Verify test fails (RED) or stands as a regression guard.
3. Implement any fix needed.
4. Verify test passes (GREEN).
5. Commit with message: "test(land-spec): legacy plan cannot satisfy the plan requirement"

**Files:** same as Task 1

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3

### Task 7: Idea's own invalid artifacts still reject; dirty-worktree guard unchanged
**Story:** TS-1 negative (idea's DRAFT stories rejected); TS-2 negative (dirty guard precedes resolution)
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Run the existing suite: the pre-existing DRAFT-stories rejection and
   dirty-worktree tests must pass unchanged against the idea-scoped resolver
   (seeded artifacts are untracked → attributable → still content-validated).
2. Add a test ONLY if either behavior lacks explicit coverage: (a) idea's own
   DRAFT-status stories → stories-not-approved error; (b) a tracked `.docs`
   file modified-but-uncommitted → dirty-worktree rejection before resolution.
3. If no new code/test is needed, complete via an empty commit with
   `Task:` + `Evidence: skipped existing-tests-cover` trailers.
5. Commit with message: "test(land-spec): idea-scoped resolution preserves content validation and dirty guard"

**Files:** same as Task 1

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3

### Task 8: Delete `findNewestFile` (no remaining callers)
**Story:** TS-2 Done-When (no corpus mtime scan remains)
**Type:** refactor

**Steps:**
1. Write check: grep `findNewestFile` in `src/conductor/src` — callers must be
   zero after pickers switched (Tasks 2–3).
2. Delete the function; run typecheck + full land-spec suite.
3. Verify suite passes (GREEN).
5. Commit with message: "refactor(land-spec): remove corpus-wide findNewestFile"

**Files:**
- src/conductor/src/engine/engineer/land-spec.ts — delete helper

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2, Task 3, Task 4, Task 5, Task 6, Task 7

### Task 9: CHANGELOG entry
**Story:** repo release gate (CHANGELOG [Unreleased] required on every PR)
**Type:** infrastructure

**Steps:**
1. Add under `## [Unreleased]` → `### Fixed`: "engineer land no longer
   false-rejects technical-track specs by validating a legacy newest-by-mtime
   spec; all landSpec artifact pickers are idea-scoped (#488)". Internal-only
   change — no migration block.
2. Run `test/test_harness_integrity.sh`.
5. Commit with message: "docs(changelog): idea-scoped land artifact resolution (#488)"

**Files:**
- CHANGELOG.md — [Unreleased] Fixed entry

**Wired-into:** none (no new production surface)

**Dependencies:** Task 8

## Task Dependency Graph

```
1 → 2 → 3 → 6
    2 → 4       \
    2 → 5        → 8 → 9
    3 → 7       /
(4,5,6,7 → 8)
```

## Integration Points

- After Task 2: the #488 repro (technical-track land with a newest-mtime
  legacy DRAFT spec) passes end-to-end via `landSpec`.
- After Task 8: full `land-spec.test.ts` suite green with zero mtime-based
  corpus scans in the module.

## Verification

- [ ] All happy path criteria covered by at least one task (TS-1→T2, TS-2→T1/T3, TS-3→T4, TS-4→T2/T5)
- [ ] All negative path criteria covered by at least one task (TS-1→T2/T7, TS-2→T6/T7, TS-3→T4, TS-4→T5)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
