# Implementation Plan: Tests leak fixture slugs into the parked-feature ledger (#1251)

**Date:** 2026-08-02
**Track:** technical (no PRD)
**Complexity:** `.docs/complexity/tests-leak-fixture-slugs-into-the-parked-feature-l.md` (Tier S)
**Stories:** `.docs/stories/tests-leak-fixture-slugs-into-the-parked-feature-l.md`
**Conflict check:** skipped (Tier S)

## Summary

Contain vitest fixture roots so repo-resolving production code can never reach the developer's
real repository, and add a `park-leak-guard` that fails the run if the real `.daemon/parked/`
ledger changed. 9 tasks, all inside `src/conductor/test/` and `src/conductor/vitest.config.ts`.

## Technical Approach

**Verified root cause.** `writeAutoPark`/`writeOperatorPark`/`removeOperatorPark`
(`src/conductor/src/engine/park-marker.ts`) call `resolveMainRepoRoot(root)`, which runs
`git rev-parse --git-common-dir` from `root`. Every fixture root is
`mkdtemp(join(tmpdir(), …))`, and `os.tmpdir()` reads `TMPDIR` at call time. When `TMPDIR`
resolves inside a git repository, discovery walks **up** to that repository and the marker is
written to *its* `.daemon/parked/`. Reproduced directly: with `TMPDIR` inside a disposable
git repo, one run of `test/engine/park-marker.test.ts` deposited nine fixture slugs
(`slug-1`, `slug-2`, `non-git-feature`, `callback-fire-test`, …) into that repo's root.

**`park-marker.ts` is not changed.** Resolving to the main root is the #486 fix that makes
worktree-written markers visible to the daemon gate. The defect is that the harness permits a
fixture root to sit inside a real repository at all.

**Mechanism 1 — containment (`GIT_CEILING_DIRECTORIES`).** `ensureRunTmpRootSync`
(`src/conductor/test/tmpdir-leak-guard.ts`, called from `vitest.config.ts` module scope)
already creates the run-scoped temp root and points `TMPDIR` at it. Add a second env
install in the same place: append the run root's **realpath** to `GIT_CEILING_DIRECTORIES`.
Git then stops upward discovery at the run root, so any path beneath it that is not itself a
repository resolves to nothing and `resolveMainRepoRoot` takes its existing `startDir`
fallback. Verified against real `git` on all four cases that matter:

| From | Ceiling | `git rev-parse --git-common-dir` |
| --- | --- | --- |
| fixture under run root, enclosing repo above | none | `../../../.git` — **the leak** |
| same | run root | `fatal: not a git repository` — contained |
| fixture that is its own repo | run root | `.git` — still works |
| linked worktree of a fixture repo | run root | fixture repo's git dir — **#486 preserved** |

Realpath matters: git resolves symlinks when matching ceiling entries, and `/tmp` is a
symlink on some systems. Appending (rather than overwriting) preserves any operator-set
value. Installing it in `vitest.config.ts` module scope — the same stage as `TMPDIR` — is
what makes it inherit into the forked workers.

**Mechanism 2 — detection (`park-leak-guard`).** A fifth sibling to
`pipeline-leak-guard` / `tmux-leak-guard` / `signals-leak-guard` / `tmpdir-leak-guard`,
following their exact split: a `snapshot…` fs function plus a pure `diff…` function in
`src/conductor/test/park-leak-guard.ts`, and a pure `apply…TeardownDecision` throw-vs-warn
function in `src/conductor/test/global-setup.ts` next to its three peers. It snapshots the
**real** repository's `.daemon/parked/` (slug → content) before any test runs and diffs at
teardown; any added, removed, or modified marker fails the run. It watches the real path
resolved independently of any test-process redirect — the same deliberate stance as
`REAL_ENGINEER_DIR`, which ignores the env var the tests redirect so the guard can prove the
redirect works. Ordered **last** in `runTeardownGuards()` so it never pre-empts an existing,
more specific verdict. It reports only; it never repairs the operator's real markers.

**Sequencing.** Guard first (Tasks 1–5) so the detection exists and is provably wired before
the containment lands; containment second (Tasks 6–7); the two end-to-end regressions that
close #1251 last (Tasks 8–9), since they depend on both mechanisms.

## Prerequisites

- None. All touched files exist; no new dependencies, no migrations.

## Tasks

### Task 1: Snapshot + diff primitives for the real parked ledger
**Story:** Story 2 — happy path (empty diff), added/removed/modified marker
**Type:** infrastructure

**Steps:**
1. Write failing test: `snapshotParkedMarkers(dir)` returns `{ exists: true, markers: { slug: content } }`
   for a directory with two markers; `diffParkedMarkers(before, after)` returns
   `{ added: [], removed: [], modified: [] }` for identical snapshots, `added: ['x']` for a new
   marker, `removed: ['x']` for a deleted one, and `modified: ['x']` when a body changes.
2. Verify tests fail (RED)
3. Implement both functions in a new `src/conductor/test/park-leak-guard.ts`, mirroring
   `pipeline-leak-guard.ts`'s `Snapshot`/`Diff` interface shape. Files only (`isFile()`),
   top level only.
4. Verify tests pass (GREEN)
5. Commit: "test(guard): add park-leak-guard snapshot and diff primitives"

**Files likely touched:**
- `src/conductor/test/park-leak-guard.ts` — new module: `ParkedSnapshot`, `ParkedDiff`,
  `snapshotParkedMarkers`, `diffParkedMarkers`
- `src/conductor/test/park-leak-guard.test.ts` — new unit tests

**Wired-into:** `src/conductor/test/global-setup.ts#setup`,
`src/conductor/test/global-setup.ts#runTeardownGuards`

**Dependencies:** none

---

### Task 2: Resilient snapshot behavior — absent directory and unreadable baseline
**Story:** Story 2 — negative paths (absent directory is a valid empty ledger; failed
baseline fails open)
**Type:** negative-path

**Steps:**
1. Write failing test: `snapshotParkedMarkers` on a non-existent path returns
   `{ exists: false, markers: {} }` and does not throw; `diffParkedMarkers` returns an
   all-empty diff when either side has `exists: false`.
2. Verify tests fail (RED)
3. Implement: wrap the `readdir`/`readFile` in try/catch returning `{ exists: false }`, and
   short-circuit the diff when either snapshot is absent — matching `diffTmpdirEntries`'s
   documented fail-open stance.
4. Verify tests pass (GREEN)
5. Commit: "test(guard): fail open when the parked snapshot cannot be read"

**Files likely touched:**
- `src/conductor/test/park-leak-guard.ts` — resilience branches
- `src/conductor/test/park-leak-guard.test.ts` — absent/unreadable cases

**Wired-into:** same as Task 1

**Dependencies:** Task 1

---

### Task 3: Throw-vs-warn teardown decision
**Story:** Story 2 — negative path (decision function unit-testable in isolation)
**Type:** infrastructure

**Steps:**
1. Write failing test: `applyParkTeardownDecision` throws for a diff with `added: ['slug-1']`,
   for `removed`, and for `modified`, with a message naming the slugs and containing `#1251`;
   returns silently for an all-empty diff.
2. Verify test fails (RED)
3. Implement `export function applyParkTeardownDecision(diff, realParkedDir, logger)` in
   `src/conductor/test/global-setup.ts`, alongside `applyTeardownDecision`,
   `applyEngineerSignalsTeardownDecision`, and `applyTmpdirTeardownDecision`.
4. Verify test passes (GREEN)
5. Commit: "test(guard): fail the run when the real parked ledger changed"

**Files likely touched:**
- `src/conductor/test/global-setup.ts` — new exported decision function
- `src/conductor/test/park-leak-guard.test.ts` — decision assertions

**Wired-into:** `src/conductor/test/global-setup.ts#runTeardownGuards`

**Dependencies:** Task 1

---

### Task 4: Resolve the REAL parked directory independently of test redirects
**Story:** Story 3 — happy path (guard resolves the real path independently of any redirect)
**Type:** infrastructure

**Steps:**
1. Write failing test: `resolveRealParkedDir(cwd)` returns `<repoRoot>/.daemon/parked` for a
   fixture repo and for a linked worktree of it (both give the main root); returns `null` for
   a directory that is not in a git repository.
2. Verify test fails (RED)
3. Implement in `src/conductor/test/park-leak-guard.ts` using its own `git rev-parse
   --git-common-dir` call — deliberately NOT importing `park-marker.ts`, so the guard cannot
   be blinded by the very code it is guarding (same rationale as `REAL_ENGINEER_DIR`).
4. Verify test passes (GREEN)
5. Commit: "test(guard): resolve the real parked dir independently of park-marker.ts"

**Files likely touched:**
- `src/conductor/test/park-leak-guard.ts` — `resolveRealParkedDir`
- `src/conductor/test/park-leak-guard.test.ts` — repo, worktree, and non-repo cases

**Wired-into:** same as Task 3

**Dependencies:** Task 1

---

### Task 5: Wire the guard into the real vitest lifecycle
**Story:** Story 3 — happy paths (snapshot in `setup()`, evaluate at teardown, clean run is
silent) and negative paths (never pre-empts an existing guard; unexpected error degrades to a
warning; never repairs real markers)
**Type:** infrastructure

**Steps:**
1. Write failing test: assert `global-setup.ts` evaluates the park guard **after** the
   `.pipeline`, tmux, and signals guards — a run with both a `.pipeline` leak and a park leak
   reports the `.pipeline` failure. Assert an unexpected non-guard error from the park guard
   is logged, not thrown.
2. Verify test fails (RED)
3. Implement: in `setup()`, resolve the real parked dir and take `parkedBefore` before the
   first test; in `runTeardownGuards()`, re-snapshot, diff, and call
   `applyParkTeardownDecision` — placed last, inside the same defensive try/catch shape used
   for the signals guard (re-throw only its own `park-leak-guard:` errors). No write path.
4. Verify test passes (GREEN)
5. Commit: "test(guard): wire park-leak-guard into global setup and teardown"

**Files likely touched:**
- `src/conductor/test/global-setup.ts` — snapshot in `setup()`, evaluation in
  `runTeardownGuards()`
- `src/conductor/test/park-leak-guard.test.ts` — ordering and fail-safe assertions

**Wired-into:** `src/conductor/test/global-setup.ts#setup`,
`src/conductor/test/global-setup.ts#runTeardownGuards`

**Dependencies:** Task 2; Task 3; Task 4

---

### Task 6: Install the git ceiling on the run temp root
**Story:** Story 1 — happy path (discovery stops at the run root) and negative path (failure
to install fails the run loudly at setup)
**Type:** infrastructure

**Steps:**
1. Write failing test: `ensureRunTmpRootSync(realTmpdir, env)` sets
   `env.GIT_CEILING_DIRECTORIES` to the run root's realpath; appends with `:` when the var is
   already set rather than overwriting; is idempotent across a second call (no duplicate
   entry, no second root); throws a named error if the run root's realpath cannot be resolved.
2. Verify tests fail (RED)
3. Implement in `src/conductor/test/tmpdir-leak-guard.ts` alongside the existing `TMPDIR`
   install, with a header comment recording why the realpath (git resolves symlinks when
   matching ceiling entries) and why module scope (inheritance into forked workers).
4. Verify tests pass (GREEN)
5. Commit: "test(guard): stop git discovery at the run temp root"

**Files likely touched:**
- `src/conductor/test/tmpdir-leak-guard.ts` — ceiling install in `ensureRunTmpRootSync`
- `src/conductor/test/tmpdir-leak-guard.test.ts` — set/append/idempotent/throw cases

**Wired-into:** `src/conductor/vitest.config.ts#ensureRunTmpRootSync`

**Dependencies:** none

---

### Task 7: Prove the ceiling reaches forked workers
**Story:** Story 1 — happy path (a forked worker inherits the containment)
**Type:** negative-path

**Steps:**
1. Write failing test: from inside a worker, assert `process.env.GIT_CEILING_DIRECTORIES`
   contains the run root, and that `git rev-parse --git-common-dir` run from a freshly
   `mkdtemp`'d fixture directory fails rather than returning a path outside the run root.
2. Verify test fails (RED)
3. Implement: extend `src/conductor/test/tmpdir-redirect-propagation.test.ts` with a
   `git ceiling propagation` describe block, mirroring its existing empirical-proof rationale.
4. Verify test passes (GREEN)
5. Commit: "test(guard): prove the git ceiling propagates into forked workers"

**Files likely touched:**
- `src/conductor/test/tmpdir-redirect-propagation.test.ts` — ceiling propagation block

**Wired-into:** none (no new production surface)

**Dependencies:** Task 6

---

### Task 8: Regression — containment preserves legitimate in-fixture git resolution
**Story:** Story 1 — happy paths (fixture's own repo resolves; linked worktree resolves,
#486 preserved) and negative path (non-git fixture root falls back to itself)
**Type:** negative-path

**Steps:**
1. Write failing test: with the ceiling active, `resolveMainRepoRoot` returns the fixture's
   own repo root for a `git init`'d fixture; returns the fixture repo's root from a linked
   worktree of it; returns the passed directory unchanged for a non-git fixture.
2. Verify test fails (RED)
3. Implement: add the cases to `src/conductor/test/engine/park-marker.test.ts` (the file that
   already owns `initRepoWithWorktree` and the non-git fallback suite); adjust only test
   scaffolding — `src/conductor/src/engine/park-marker.ts` stays byte-for-byte unchanged.
4. Verify tests pass (GREEN)
5. Commit: "test(park-marker): keep #486 worktree resolution under the git ceiling"

**Files likely touched:**
- `src/conductor/test/engine/park-marker.test.ts` — containment-compatibility cases

**Wired-into:** none (no new production surface)

**Dependencies:** Task 6

---

### Task 9: Regression — the reported leak no longer reproduces
**Story:** Story 1 — negative path (`TMPDIR` nested in a real repo leaks nothing); Story 3 —
happy path (a run leaves the real ledger byte-for-byte unchanged)
**Type:** negative-path

**Steps:**
1. Write failing test: create a disposable git repository, point a fixture root inside it,
   write a park marker via `writeAutoPark` from that fixture, and assert the marker landed at
   `<fixture>/.daemon/parked/<slug>` and that the enclosing repository's `.daemon/parked/` is
   absent or empty. Name the exact slugs from #1251 (`slug-1`, `non-git-feature`,
   `callback-fire-test`) so the regression is self-documenting.
2. Verify test fails (RED) — confirm it reproduces the original leak with the ceiling removed
3. Implement: rely on the Task 6 containment; add the test to
   `src/conductor/test/park-leak-guard.test.ts`.
4. Verify test passes (GREEN)
5. Commit: "test(guard): regression for #1251 fixture park-marker leak"

**Files likely touched:**
- `src/conductor/test/park-leak-guard.test.ts` — enclosing-repo reproduction case

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5; Task 6

---

## Task Dependency Graph

```
Task 1 ──┬── Task 2 ──┐
         ├── Task 3 ──┤
         └── Task 4 ──┴── Task 5 ──┐
                                   ├── Task 9
Task 6 ──┬── Task 7                │
         ├── Task 8                │
         └───────────────────────────┘
```

- Tasks 1 and 6 are independent roots and may run in parallel.
- Task 9 requires both the wired guard (Task 5) and the containment (Task 6).

## Integration Points

- **After Task 5:** the guard is live — a full `vitest run` now fails if anything changes the
  real `.daemon/parked/`, even before containment exists. This is the detection half of
  #1251's desired outcome and is independently verifiable.
- **After Task 6:** containment is live — the reproduction from the issue no longer leaks.
- **After Task 9:** both halves are proven together against the exact reported failure.

## Coverage Mapping

| Story | Criterion | Task(s) |
| --- | --- | --- |
| 1 | Discovery stops at the run root | 6, 7 |
| 1 | Fixture's own repo still resolves | 8 |
| 1 | Linked worktree still resolves (#486) | 8 |
| 1 | Forked worker inherits containment | 7 |
| 1 | `TMPDIR` inside a real repo leaks nothing | 9 |
| 1 | Non-git fixture root falls back to itself | 8 |
| 1 | Containment cannot be installed → fail loudly | 6 |
| 1 | `park-marker.ts` unchanged | 8 |
| 2 | Identical snapshots → empty diff, run passes | 1 |
| 2 | Added marker → fail naming slug | 1, 3 |
| 2 | Removed marker → fail naming slug | 1, 3 |
| 2 | Modified marker → fail naming slug | 1, 3 |
| 2 | Absent directory → no leak, no throw | 2 |
| 2 | Unreadable baseline → warn, not fail | 2 |
| 2 | Decision function unit-testable in isolation | 3 |
| 3 | Snapshot taken in `setup()` before any test | 5 |
| 3 | Guard evaluated at teardown, silent when clean | 5 |
| 3 | Real path resolved independently of redirects | 4 |
| 3 | Full run leaves real ledger byte-for-byte unchanged | 5, 9 |
| 3 | Never pre-empts an existing guard's verdict | 5 |
| 3 | Unexpected error degrades to a warning | 5 |
| 3 | Guard never writes to / removes real markers | 5 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic
- [x] Every task carries a `**Wired-into:**` line
- [x] No terminal catch-all validation task
