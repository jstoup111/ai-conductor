# Implementation Plan: live-boundary halts self-host builds when the operator edits their own checkout

**Date:** 2026-07-28
**Track:** technical (no PRD) — `.docs/track/live-boundary-halts-self-host-builds-when-the-oper.md`
**Complexity:** S — `.docs/complexity/live-boundary-halts-self-host-builds-when-the-oper.md`
**Stories:** `.docs/stories/live-boundary-halts-self-host-builds-when-the-oper.md` (Status: Accepted, 3 stories)
**Decision record:** `.memory/decisions/live-boundary-halts-self-host-builds-when-the-oper.md`
**Conflict check:** skipped (Small tier)

## Summary

Adds git-aware classification to `verifyLiveBoundary`'s "live checkout" surface only, so a
differing path that git shows as a tracked, git-explicable working-tree change (an operator
editing or deleting an already-tracked file) no longer halts an in-flight self-host build. Any
untracked path, or any indeterminate/failed classification, still halts exactly as today
(fail-closed). 9 tasks.

## Technical Approach

- New pure function `classifyLiveCheckoutDiff` in `src/conductor/src/engine/self-host/live-boundary.ts`
  takes the live-checkout root and the list of differing paths (from the existing
  `diffManifests` output — added/removed/changed) and returns, per path, `'operator-edit'` or
  `'unexplained'`. It shells out to `git status --porcelain=v1 -- <path>` (or `git diff
  --name-status` scoped to the path set) run with `cwd: liveCheckout`. A path is `'operator-edit'`
  only when git's porcelain output shows it as a tracked modification (`M`/staged variants) or a
  tracked deletion (`D`); an untracked marker (`??`), any unexpected/unparseable porcelain line, or
  a thrown/non-zero git invocation classifies that path (and, per fail-closed, the whole surface)
  as `'unexplained'`.
- `verifyLiveBoundary` (the loop over `snapshot.surfaces`) changes ONLY for the surface labelled
  `'live checkout'`: when a mismatch is detected, before building the halt `reason`, it calls
  `classifyLiveCheckoutDiff` with the union of `diff.added`/`diff.removed`/`diff.changed` paths. If
  every path classifies as `'operator-edit'`, the surface is treated as clean (skip to the next
  surface / fall through to `{ ok: true }` for this surface) instead of returning `{ ok: false }`.
  If classification itself throws, or any path is `'unexplained'`, behavior is byte-for-byte
  unchanged from today (same `describeDiff`-built reason, same halt). The `'provider state'`
  surface is untouched — the branch only applies when `surface.label === 'live checkout'`.
- No change to `LIVE_CHECKOUT_VOLATILE`, `CLAUDE_PROVIDER_STATE_VOLATILE`,
  `CODEX_PROVIDER_STATE_VOLATILE`, `diffManifests`, or `describeDiff`. No change to
  `fingerprintLiveBoundary`'s signature. No change needed at the `conductor.ts` call site
  (`prepareCandidateSelfHost`'s `verify()`, ~line 2157-2162) — it already just calls
  `verifyLiveBoundary(boundary)` and consumes `{ ok, reason }`, which stays the same shape.
- Known accepted limitation (operator-confirmed, see decision record): git can only distinguish
  tracked-vs-untracked, not writer identity, so a sandbox escape that overwrites an *already-tracked*
  file's content is also amnestied. This must be documented in the module comment (near the new
  function) and in `docs/guides/self-hosting.md`, not left implicit.
- Tests exercise real `git` in real `mkdtemp` + `git init` repos, matching the existing style in
  `src/conductor/test/engine/self-host/live-boundary.test.ts` — no git mocking (local CLI, not a
  third-party boundary per this repo's test-isolation policy).

## Prerequisites

None — the target file and its test file already exist; no new dependencies.

## Tasks

### Task 1: RED — operator edits a tracked file mid-build, no halt
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "Operator's tracked-file edit…" / Happy Path #1
**Type:** happy-path

**Steps:**
1. Write failing test in `live-boundary.test.ts`: `mkdtemp`, `git init` + `git config user.email/name`
   inside `live`, commit an initial tracked file (e.g. `README.md`), fingerprint via
   `fingerprintLiveBoundary`, then modify the tracked file's content (no commit), and assert
   `verifyLiveBoundary(boundary)` resolves `{ ok: true }`.
2. Run the test, confirm it fails (current code halts on any content drift).

**Files:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — new test case

**Wired-into:** none (no new production surface)

**Dependencies:** none

---

### Task 2: GREEN — implement `classifyLiveCheckoutDiff` and wire it into `verifyLiveBoundary`
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "Operator's tracked-file edit…" / Happy Path #1
**Type:** happy-path

**Steps:**
1. Implement `classifyLiveCheckoutDiff(root: string, paths: readonly string[]): Promise<Map<string, 'operator-edit' | 'unexplained'>>`
   in `live-boundary.ts`, using `child_process` (`execFile`/`exec`, promisified) to run
   `git -C <root> status --porcelain=v1 -- <paths...>`, parsing `M `/` M`/`MM` (modified) and `D `/`
   ` D` (deleted) index/worktree codes as `'operator-edit'`; `??` and anything else as
   `'unexplained'`. Any thrown error resolves every requested path to `'unexplained'`.
2. In `verifyLiveBoundary`, for the surface with `label === 'live checkout'` only, after computing
   `diff`, call `classifyLiveCheckoutDiff` with `[...diff.added, ...diff.removed, ...diff.changed]`;
   if every entry maps to `'operator-edit'`, `continue` the surfaces loop (this surface counts as
   clean) instead of returning `{ ok: false }`.
3. Run Task 1's test, confirm it passes (GREEN).
4. Commit with message: "self-host: classify live-checkout diffs to suppress operator-edit halts"

**Files:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — new `classifyLiveCheckoutDiff` function; `verifyLiveBoundary` gains the live-checkout-only classification branch

**Wired-into:** `src/conductor/src/engine/self-host/live-boundary.ts#verifyLiveBoundary`

**Dependencies:** Task 1

---

### Task 3: RED — operator deletes a tracked file mid-build, no halt
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "Operator's tracked-file edit…" / Happy Path #2
**Type:** happy-path

**Steps:**
1. Write a test: commit a tracked file, fingerprint, then `rm` it (no `git rm`, just delete the
   working-tree file — matches how an operator's editor/`rm` would behave), assert
   `verifyLiveBoundary` returns `{ ok: true }`.
2. Confirm it currently fails only if the `D` porcelain code isn't yet handled by Task 2's
   implementation — if Task 2 already parses `D`, this may pass immediately; still author it as its
   own RED/GREEN pair per TDD discipline (revert the `D` handling locally to confirm RED, then
   restore).

**Files:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — new test case

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

---

### Task 4: GREEN — confirm tracked-deletion classification
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "Operator's tracked-file edit…" / Happy Path #2
**Type:** happy-path

**Steps:**
1. If Task 3's test already passes against Task 2's implementation, this task is verify-only.
   Otherwise extend the porcelain parser to cover the deletion status codes correctly.
2. Confirm Task 3's test passes.
3. Commit with message: "self-host: cover tracked-file deletion in live-checkout classification" (or an empty commit with `Evidence: skipped` trailer if verify-only — see Verify-only marker below).

**Files:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — porcelain status parsing (if needed)

**Wired-into:** same as Task 2

**Verify-only:** yes

**Dependencies:** Task 3

---

### Task 5: RED + GREEN — multiple simultaneous operator edits all classify cleanly
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "Operator's tracked-file edit…" / Happy Path #3
**Type:** happy-path

**Steps:**
1. Write a test: commit 2+ tracked files, fingerprint, modify all of them, assert
   `verifyLiveBoundary` returns `{ ok: true }` (proves classification is evaluated per differing
   path, not short-circuited on the first one).
2. Confirm it fails only if the current implementation mishandles a multi-path `git status`
   invocation (e.g. only classifies the first path) — fix if so, otherwise this is verify-only.
3. Commit with message: "self-host: verify multi-path operator-edit classification" (or empty
   commit with `Evidence: skipped` trailer if verify-only).

**Files:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — new test case
- `src/conductor/src/engine/self-host/live-boundary.ts` — only if a multi-path bug is found

**Wired-into:** same as Task 2

**Verify-only:** yes

**Dependencies:** Task 4

---

### Task 6: RED — a mix of one operator edit and one untracked file still halts
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "Operator's tracked-file edit…" / Negative Path
**Type:** negative-path

**Steps:**
1. Write a test: commit a tracked file, fingerprint, modify the tracked file AND create a new
   untracked file in the same window, assert `verifyLiveBoundary` returns `{ ok: false }` with the
   untracked path named in `reason` (via existing `describeDiff`).
2. Confirm it fails if the implementation amnesties the whole surface on a partial match (it
   shouldn't, given Task 2's "every entry" check, but this locks the behavior with a test).

**Files:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — new test case

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

---

### Task 7: GREEN — confirm partial-amnesty rejection
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "Operator's tracked-file edit…" / Negative Path
**Type:** negative-path

**Steps:**
1. Confirm Task 6's test passes against the existing "every entry must classify as operator-edit"
   logic from Task 2. This should already hold; treat as verify-only unless a bug surfaces.
2. Commit: empty commit with `Task: 7` + `Evidence: skipped — behavior already covered by Task 2's
   all-paths-must-match check` trailers, per this repo's Verify-only commit form — OR a real commit
   if a fix was needed.

**Files:** same as Task 6

**Wired-into:** same as Task 2

**Verify-only:** yes

**Dependencies:** Task 6

---

### Task 8: RED + GREEN — untracked-path escape still halts with the path named (regression lock)
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "A sandbox-escape-shaped diff…" / Happy Path #1
**Type:** negative-path

**Steps:**
1. Write a test: fingerprint a `live` git repo with no untracked files, then create a new untracked
   file (simulating an escape), assert `verifyLiveBoundary` returns `{ ok: false }` and `reason`
   contains the file's path (reusing `describeDiff`'s existing "added" wording — assert on
   substring/shape, not a hand-duplicated formatter).
2. Confirm this passes against the Task 2 implementation (untracked always classifies
   `'unexplained'`) — should already hold; this is a regression-lock test more than new behavior.
3. Commit with message: "self-host: lock untracked-path escape still halts (regression)" or empty
   commit if verify-only.

**Files:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — new test case

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 6

---

### Task 9: RED + GREEN — classification failure fails closed (non-repo / git error)
**Story:** live-boundary-halts-self-host-builds-when-the-oper.md — "Git classification failure fails closed"
**Type:** negative-path

**Steps:**
1. Write a test: fingerprint a `live` directory that is NOT a git repository (no `git init`), then
   modify a file, assert `verifyLiveBoundary` returns `{ ok: false }` — same as pre-change behavior.
2. Write a second test that stubs/forces `classifyLiveCheckoutDiff`'s git invocation to reject (e.g.
   by pointing at a nonexistent `git` binary via a small seam, OR — preferred, no new seam — by
   using a path containing a character that makes the specific `git status` invocation error) and
   asserts the surface still halts rather than defaulting to `{ ok: true }`.
3. Confirm both fail before the fail-closed catch is implemented (if Task 2 already wraps the git
   call in try/catch → 'unexplained' for all paths, these may already pass; still author as
   RED/GREEN to lock the contract).
4. If a gap is found, wrap the git invocation so any thrown error/non-zero unexpected exit maps
   every path in that call to `'unexplained'` (never lets an exception propagate up as a false
   `{ ok: true }`).
5. Run the pre-existing "rejects terminal success when either live surface drifts" test and the
   `#985` bookkeeping-exclusion test and the `#1113` provider-state tests unmodified — confirm all
   still pass (no regression).
6. Commit with message: "self-host: fail closed on live-checkout classification errors"

**Files:**
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — new test cases
- `src/conductor/src/engine/self-host/live-boundary.ts` — fail-closed error handling (if not already present from Task 2)

**Wired-into:** same as Task 2

**Dependencies:** Task 8

---

### Task 10: Document the change and its accepted residual gap
**Story:** cross-cutting (all three stories' "Known limitation" note + repo documentation-upkeep rule)
**Type:** infrastructure

**Steps:**
1. Update `src/conductor/src/engine/self-host/live-boundary.ts`'s module-level comment (the block
   documenting `LIVE_CHECKOUT_VOLATILE`, lines ~10-35) to describe the new classification branch and
   explicitly state the accepted limitation: a sandbox escape overwriting an *already-tracked*
   file's content is indistinguishable from an operator edit and is not caught.
2. Update `docs/guides/self-hosting.md`:
   - Line ~238-239 ("None of these is harness source… adding, modifying, or deleting a tracked
     source file under the live checkout still trips it.") — correct: a tracked source file's
     modification or deletion by the operator no longer trips it; an untracked file still does.
   - Line ~274-275 ("do not edit the harness checkout… while a self-host build is running") —
     narrow this guidance: editing a *tracked* file is now safe; creating new/untracked files, or
     editing provider config, is still unsafe.
   - Line ~352-354 (Troubleshooting: "Typical causes are an editor save…") — remove "an editor
     save" from the list of typical live-checkout-surface causes (that's now handled), keep it for
     the provider-state surface where it still applies.
   - Add a short note on the accepted residual gap (tracked-file-content escapes are not caught) so
     an operator debugging a real incident doesn't assume this guard is airtight against that case.
3. Add a `CHANGELOG.md` entry under `## [Unreleased]` → `### Fixed`: a fix bullet describing that
   editing a tracked file in the live checkout no longer false-halts a self-host build, referencing
   #1115 and noting the untracked-path/provider-state detection is unchanged. No `VERSION` bump
   (version-locked-until-v1 convention already in effect for this repo) and no `## Migration` block
   (no `settings.json`/CLI/hook/schema change — this is internal self-host engine behavior only, not
   a `bin/conduct` CLI, hook wiring, or settings schema surface, so no release-gate waiver is needed
   either).
4. Commit with message: "docs(self-host): document live-checkout git-aware classification and its
   residual gap"

**Files:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — module comment update
- `docs/guides/self-hosting.md` — live boundary section updates
- `CHANGELOG.md` — Unreleased/Fixed entry

**Wired-into:** none (no new production surface)

**Dependencies:** Task 9

## Task Dependency Graph

```
1 → 2 → 3 → 4 → 5 → 6 → 7
                  6 → 8
                  7 → 9 (via 8)
9 → 10
```

Linear in practice: 1→2→3→4→5→6→7, then 6→8 (parallel-eligible with 7 but sequenced here for
TDD-cycle clarity), 8→9, 9→10.

## Integration Points

- After Task 2: the core happy-path classification works end-to-end (tracked-edit → no halt) for
  the simplest case; can be smoke-checked against the real `live-boundary.test.ts` suite.
- After Task 9: full behavioral contract (happy paths, negative paths, fail-closed) is locked by
  tests; safe to run the full `self-host` test file and the broader `test/test_harness_integrity.sh`
  suite.
- After Task 10: documentation and changelog are consistent with shipped behavior — ready for PR.

## Verification

- [x] All happy path criteria covered: Task 1-2 (edit), Task 3-4 (deletion), Task 5 (multi-path)
- [x] All negative path criteria covered: Task 6-7 (partial mix), Task 8 (untracked escape), Task 9
      (fail-closed)
- [x] No task exceeds ~5 minutes of work (several are verify-only, expected to be fast confirmations)
- [x] Dependencies are explicit and acyclic
- [x] Every task touching the new production surface (`classifyLiveCheckoutDiff` /
      `verifyLiveBoundary`) carries `**Wired-into:**` — declared at Task 2, inherited via `same as
      Task 2` elsewhere
- [x] Documentation task (10) covers the accepted residual-gap disclosure and the CHANGELOG entry
      per this repo's release gates
