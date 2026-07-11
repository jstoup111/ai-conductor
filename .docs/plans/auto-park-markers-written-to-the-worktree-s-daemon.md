# Implementation Plan: Park-Marker Main-Root Resolution (#486)

**Date:** 2026-07-10
**Design:** .docs/decisions/adr-2026-07-10-park-marker-main-root-resolution.md (APPROVED)
**Stories:** .docs/stories/auto-park-markers-written-to-the-worktree-s-daemon.md (Accepted)
**Conflict check:** Clean as of 2026-07-10
**Diagram:** .docs/architecture/2026-07-10-park-marker-main-root-resolution.md (approved; already reflects planned state)

## Summary

Anchor every `.daemon/parked/<slug>` operation to the MAIN repository root by resolving
inside `park-marker.ts`, fix unpark's counter-reset target, echo the marker path from the
park CLI, and reconcile stranded worktree markers at rekick-sweep start. 16 tasks.

## Technical Approach

- **One new seam in `park-marker.ts`:** `resolveMainRepoRoot(startDir)` runs
  `git rev-parse --git-common-dir` (promisified `execFile`, same pattern as
  `memory-store.ts:25–28`) with cwd `startDir`; relative output is joined against
  `startDir` (same handling as `memory-store.ts:stableIdentity`); the common dir's parent
  is the main root. ANY failure → return `startDir` (pre-#486 behavior) and report via an
  optional log callback. Memoize per `startDir` in a module-level Map; expose an
  injectable git-runner + cache-reset hook for tests (per the injected-runner +
  real-binary-smoke convention).
- **Primitives route through the resolver:** each of the six exported primitives resolves
  its `root` argument first. Call sites (`conductor.ts:1855` auto-park via
  `daemon-auto-park.ts`, `daemon-cli.ts:720/1051/1088/1164`, `daemon-park-cli.ts`,
  dashboard) need no changes — verified by integration tests on a real temp repo with a
  linked worktree.
- **CLI (`daemon-park-cli.ts`):** resolve once at dispatch start; `validateSlug` checks
  the RESOLVED root; `park` echoes the absolute marker path. `unpark` for auto-provenance
  resets `.worktrees/<slug>/.pipeline/task-evidence.json` under the resolved root when the
  worktree exists (else the resolved root's `.pipeline/`, the pre-#486 target), and only
  removes the marker AFTER a successful reset (no freed-but-doomed state).
- **Reconciliation:** `reconcileStrandedParkMarkers(mainRoot, log)` in `park-marker.ts`
  scans `.worktrees/*/.daemon/parked/*`, moving each marker (body preserved) to
  `<main>/.daemon/parked/<name>`; main copy wins on conflict; per-marker failures logged
  and skipped. Wired at the TOP of the `rekickSweep` dep wrapper in `daemon-cli.ts:1199`
  so the same sweep that reconciles also skips.
- **Sequencing:** resolver first (everything depends on it), then primitive routing, then
  the regression proof, then CLI behaviors, then reconciliation + wiring, then docs.
- **Tests:** vitest from `src/conductor` (never the worktree root). Temp git repos via
  `mkdtemp` under the test's own tmp parent (never a bare `/tmp` scan); production spawns
  already env-kill-switch-guarded.

## Prerequisites

- None (no schema/config/migration; marker layout unchanged). `npm install` in this
  worktree's `src/conductor` if not yet done.

## Tasks

### Task 1: resolveMainRepoRoot — worktree and main-root resolution
**Story:** Story 1 (happy: worktree → main; main → main)
**Type:** infrastructure

**Steps:**
1. Write failing tests: create a temp git repo (init + commit), add a linked worktree via
   `git worktree add`; assert `resolveMainRepoRoot(worktreeDir)` === main root and
   `resolveMainRepoRoot(mainRoot)` === main root (relative `.git` joined before parent).
2. Verify RED.
3. Implement `resolveMainRepoRoot` in `park-marker.ts`: injectable git runner
   (promisified `execFile` default), `--git-common-dir`, relative-join, `dirname`.
4. Verify GREEN.
5. Commit: "feat(park-marker): resolveMainRepoRoot anchors any in-repo dir to main root"

**Files:**
- src/conductor/src/engine/park-marker.ts
- src/conductor/src/engine/park-marker.test.ts

**Dependencies:** none

### Task 2: resolveMainRepoRoot — fallback negatives
**Story:** Story 1 (negative: non-git dir, git failure, missing dir → identity, observable)
**Type:** negative-path

**Steps:**
1. Write failing tests: non-git temp dir → returns input; injected runner that rejects →
   returns input AND invokes the log callback; nonexistent path → returns input, no throw.
2. Verify RED.
3. Implement the catch-all fallback + optional `onResolveError` callback.
4. Verify GREEN.
5. Commit: "feat(park-marker): resolution falls back to startDir on any git failure"

**Files:** same

**Dependencies:** 1

### Task 3: resolveMainRepoRoot — memoization
**Story:** Story 1 (happy: second call spawns no subprocess)
**Type:** happy-path

**Steps:**
1. Write failing test: counting injected runner; two resolutions of the same dir → runner
   called once; different dir → called again. Include a cache-reset test hook so suites
   stay isolated.
2. Verify RED.
3. Implement module-level Map memoization + `__resetResolveCacheForTests()`.
4. Verify GREEN.
5. Commit: "feat(park-marker): memoize main-root resolution per startDir"

**Files:** same

**Dependencies:** 2

### Task 4: Route write/read primitives through the resolver
**Story:** Story 2 (happy: write from worktree lands at main; both roots read true)
**Type:** happy-path

**Steps:**
1. Write failing integration tests (temp repo + linked worktree):
   `writeAutoPark(worktreeRoot, …)` → marker at `<main>/.daemon/parked/<slug>` with
   `auto-parked:` body, NO worktree `.daemon/`; `isOperatorParked` true from BOTH roots;
   same for `writeOperatorPark`.
2. Verify RED.
3. Route `writeOperatorPark`, `writeAutoPark`, `isOperatorParked` through
   `resolveMainRepoRoot`.
4. Verify GREEN.
5. Commit: "fix(park-marker): write/read primitives converge on the main repo root (#486)"

**Files:** same

**Dependencies:** 3

### Task 5: Route remaining primitives + cross-root concurrency
**Story:** Story 2 (happy: remove/list/provenance from worktree root; negative: concurrent
writers from different roots → exactly one marker)
**Type:** happy-path

**Steps:**
1. Write failing tests: `getProvenanceType(worktreeRoot)` → 'auto';
   `listOperatorParkedSlugs(worktreeRoot)` includes slug;
   `removeOperatorPark(worktreeRoot)` clears the main marker; concurrent
   `writeAutoPark(worktreeRoot)` + `writeAutoPark(mainRoot)` → one marker, no throw.
2. Verify RED.
3. Route `removeOperatorPark`, `listOperatorParkedSlugs`, `getProvenanceType`.
4. Verify GREEN.
5. Commit: "fix(park-marker): remove/list/provenance resolve to main root"

**Files:** same

**Dependencies:** 4

### Task 6: Preserved semantics — non-git identity and fail-toward-parked
**Story:** Story 2 (negative: non-git tmp roots byte-for-byte pre-#486; unreadable marker
still fails toward parked with log callback)
**Type:** negative-path

**Steps:**
1. Write failing/confirming tests: full primitive suite against a NON-git temp root
   (markers under `<tmpRoot>/.daemon/parked/`); unreadable marker (chmod 000 dir) read
   from the WORKTREE root → `true` + callback fired. Assert every pre-existing
   park-marker test passes unmodified.
2. Verify RED (or confirm green where behavior is already preserved — the new tests are
   the evidence).
3. Adjust only if a regression surfaces.
4. Verify GREEN (full `park-marker.test.ts` suite).
5. Commit: "test(park-marker): non-git fallback and fail-toward-parked semantics preserved"

**Files:** same

**Dependencies:** 5

### Task 7: Regression — capped worktree feature is skipped by the sweep
**Story:** Story 3 (happy: checkAndAutoPark from worktree → rekickSweep skips with
operator-parked log)
**Type:** happy-path

**Steps:**
1. Write failing integration test: temp repo + worktree; seed no-evidence attempts ≥ cap
   in the worktree's `.pipeline/task-evidence.json`; run
   `checkAndAutoPark(worktreeRoot, slug, {daemon: true, maxAttempts: N})`; then run
   `rekickSweep` with `isOperatorParked` bound to the MAIN root (as daemon-cli binds it);
   assert slug in `skipped` with the operator-parked log line and no abort/clear calls.
2. Verify RED (fails against pre-fix write location only if Tasks 4–5 were skipped — this
   test is the end-to-end proof and must pass with them in place; assert the marker sits
   at the main root).
3. No new implementation expected (call sites unchanged by design); fix anything the test
   exposes.
4. Verify GREEN.
5. Commit: "test(daemon): capped worktree feature parks visibly and sweep skips it (#486)"

**Files:**
- src/conductor/src/engine/daemon-auto-park.test.ts
- src/conductor/src/engine/daemon-rekick.test.ts

**Dependencies:** 5

### Task 8: Auto-park stays daemon-gated; unpark restores eligibility
**Story:** Story 3 (negatives: daemon:false writes nothing anywhere; marker removal makes
slug eligible next sweep)
**Type:** negative-path

**Steps:**
1. Write failing tests: `checkAndAutoPark(worktreeRoot, slug, {daemon: false, …})` at cap
   → no marker at EITHER root; after `removeOperatorPark`, next `rekickSweep` no longer
   skips the slug (no cached parked state).
2. Verify RED/confirm.
3. Fix anything exposed.
4. Verify GREEN.
5. Commit: "test(daemon): interactive runs never park; unpark restores sweep eligibility"

**Files:** same

**Dependencies:** 7

### Task 9: Park CLI — resolved-root validation, main-root write, absolute path echo
**Story:** Story 4 (happy: park from worktree cwd → main marker + absolute path in output;
plan-only-at-main validates from worktree cwd)
**Type:** happy-path

**Steps:**
1. Write failing tests on `dispatchDaemonPark` with `cwd` = worktree dir of a temp repo:
   marker created at main root; output line contains the absolute
   `<main>/.daemon/parked/<slug>` path; `validateSlug` passes when the plan exists only at
   the main root.
2. Verify RED.
3. Implement: resolve once at dispatch start; pass resolved root to `validateSlug`,
   marker ops, and output; add the path echo line for new parks.
4. Verify GREEN.
5. Commit: "fix(daemon-park-cli): park/unpark act on resolved main root; echo marker path (#486)"

**Files:**
- src/conductor/src/engine/daemon-park-cli.ts
- src/conductor/src/engine/daemon-park-cli.test.ts

**Dependencies:** 5

### Task 10: Park CLI negatives — typo slug, already-parked, non-git cwd
**Story:** Story 4 (negatives)
**Type:** negative-path

**Steps:**
1. Write failing tests: unknown slug from worktree cwd → exit 1, nothing written at either
   root; already-parked at main → "already parked" message, marker mtime/content
   untouched; non-git cwd → today's cwd-anchored behavior, exit 0, no crash.
2. Verify RED/confirm.
3. Implement anything exposed.
4. Verify GREEN.
5. Commit: "test(daemon-park-cli): typo'd slug, already-parked, non-git cwd negatives"

**Files:** same

**Dependencies:** 9

### Task 11: Unpark resets the counter in the feature worktree
**Story:** Story 5 (happy: worktree counter reset from any cwd; next checkAndAutoPark →
parked:false)
**Type:** happy-path

**Steps:**
1. Write failing tests: auto-parked slug with attempts ≥ cap in
   `<main>/.worktrees/<slug>/.pipeline/task-evidence.json`; `daemon unpark <slug>` with
   cwd = worktree → WORKTREE counter reset (read back 0), reset message printed; then
   `checkAndAutoPark(worktreeRoot, …)` returns `{parked:false}`.
2. Verify RED.
3. Implement: for auto provenance, target `join(resolvedRoot, '.worktrees', slug)` when it
   exists, calling `resetNoEvidenceAttempts` (task-evidence.ts:137) with that root.
4. Verify GREEN.
5. Commit: "fix(daemon-park-cli): unpark resets the no-evidence counter where it lives (#486)"

**Files:** same

**Dependencies:** 9

### Task 12: Unpark negatives — missing worktree, operator provenance, reset-failure ordering
**Story:** Story 5 (negatives)
**Type:** negative-path

**Steps:**
1. Write failing tests: worktree absent → reset falls back to resolved root's
   `.pipeline/`, exit 0, fallback stated in output; operator-parked slug → NO counter
   touched anywhere; unwritable worktree `.pipeline/` → non-zero exit AND the park marker
   still exists (removal ordered strictly after successful reset).
2. Verify RED.
3. Implement fallback + ordering (reset before `removeOperatorPark`).
4. Verify GREEN.
5. Commit: "fix(daemon-park-cli): unpark fallback + marker survives a failed counter reset"

**Files:** same

**Dependencies:** 11

### Task 13: reconcileStrandedParkMarkers — move, preserve, idempotent
**Story:** Story 6 (happy: stranded marker moved with original body; clean no-op; second
run no-op)
**Type:** happy-path

**Steps:**
1. Write failing tests: seed `.worktrees/<slug>/.daemon/parked/<slug>` with an
   `auto-parked:` body in a temp repo; run `reconcileStrandedParkMarkers(mainRoot, log)`;
   assert main marker exists with IDENTICAL body, worktree copy gone; empty repo → zero
   writes; immediate second run → no-op.
2. Verify RED.
3. Implement in `park-marker.ts`: readdir `.worktrees/*/.daemon/parked/`, copy-then-unlink
   per marker (rename is same-device here but copy+unlink survives edge mounts), skip when
   main copy exists.
4. Verify GREEN.
5. Commit: "feat(park-marker): reconcile stranded worktree park markers to main root (#486)"

**Files:**
- src/conductor/src/engine/park-marker.ts
- src/conductor/src/engine/park-marker.test.ts

**Dependencies:** 5

### Task 14: Reconciliation negatives — both roots, failure isolation, cross-slug stray
**Story:** Story 6 (negatives)
**Type:** negative-path

**Steps:**
1. Write failing tests: markers at both roots with different bodies → main body unchanged,
   worktree copy deleted; one unreadable stranded marker among two → the other still
   moves, failure logged, no throw; marker filename ≠ worktree dir name → moved keyed by
   FILENAME.
2. Verify RED.
3. Implement per-marker try/catch + filename-keyed move.
4. Verify GREEN.
5. Commit: "fix(park-marker): reconciliation is per-marker isolated, main-wins, filename-keyed"

**Files:** same

**Dependencies:** 13

### Task 15: Wire reconciliation at sweep start + same-sweep skip e2e
**Story:** Story 6 (happy: same sweep that reconciles already skips the slug)
**Type:** infrastructure

**Steps:**
1. Write failing test: daemon-level rekick dep with a pre-seeded stranded marker; invoke
   the sweep wrapper; assert the slug is skipped as operator-parked in that SAME sweep and
   the marker now lives at the main root.
2. Verify RED.
3. Implement: call `reconcileStrandedParkMarkers(projectRoot, log)` at the top of the
   `rekickSweep: async (sha) => {…}` wrapper (src/conductor/src/daemon-cli.ts:1199),
   before `rekickSweep(…)`.
4. Verify GREEN.
5. Commit: "feat(daemon): reconcile stranded park markers at rekick-sweep start (#486)"

**Files:**
- src/conductor/src/daemon-cli.ts
- src/conductor/src/engine/daemon-rekick.test.ts

**Dependencies:** 14

### Task 16: Changelog + docs + release-gate sanity
**Story:** repo conventions (CLAUDE.md: changelog on every PR; docs track features)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `## [Unreleased]` → Fixed: park markers anchor to the main repo
   root; unpark resets the worktree counter; stranded markers auto-reconciled (#486).
   Added: `daemon park` echoes the absolute marker path.
2. Update `src/conductor/README.md` daemon park/unpark section (worktree-cwd behavior,
   path echo, counter-reset location).
3. Confirm no canonical breaking surface is touched (changes live in
   `src/conductor/src/**` — not `bin/conduct`, `hooks/`, `settings*.json`, skill
   symlinks), so no migration block or waiver is required; note this in the PR body.
4. Run the full validation suite `test/test_harness_integrity.sh` + vitest from
   `src/conductor`.
5. Commit: "docs: changelog + conductor README for park-marker main-root resolution (#486)"

**Files:**
- CHANGELOG.md
- src/conductor/README.md

**Dependencies:** 15

## Task Dependency Graph

```
1 → 2 → 3 → 4 → 5 ─┬→ 6
                   ├→ 7 → 8
                   ├→ 9 ─┬→ 10
                   │     └→ 11 → 12
                   └→ 13 → 14 → 15 → 16
```

## Integration Points

- After Task 5: primitives fully converged — any caller root reaches the main marker.
- After Task 7: the #486 regression is provably closed at the daemon seam.
- After Task 12: operator CLI path (park→unpark→re-dispatch) works end-to-end.
- After Task 15: live stranded markers self-heal on the next base advance — the two
  currently-looping features park without manual ops.

## Verification

- [x] All happy path criteria covered (Tasks 1, 3, 4, 5, 7, 9, 11, 13, 15)
- [x] All negative path criteria covered as explicit tasks (Tasks 2, 6, 8, 10, 12, 14)
- [x] No task exceeds ~5 minutes
- [x] Dependencies explicit and acyclic
