# Implementation Plan: Attribution Abstain-or-Loud Hardening (#519)

**Date:** 2026-07-11
**Design:** .docs/decisions/adr-2026-07-11-attribution-abstain-or-loud.md (APPROVED)
**Stories:** .docs/stories/engine-invoked-task-attribution-494-freezes-curren.md
**Conflict check:** Clean as of 2026-07-11 (.docs/conflicts/engine-invoked-task-attribution-494-freezes-curren.md)

## Summary

Hardens the #494 attribution machinery so a bookkeeping failure abstains loudly instead of
silently misattributing every later commit to a stale task id (#519), and fixes the commit-msg
gate's id validation to check real ids instead of array indices (#501). 12 tasks across two
engine asset templates and their test seams.

## Technical Approach

- All behavior changes live in the STRING TEMPLATES `PRE_DISPATCH_HOOK`
  (`src/conductor/src/engine/session-hook-assets.ts`) and `PREPARE_COMMIT_MSG_HOOK` /
  `COMMIT_MSG_HOOK` (`src/conductor/src/engine/git-hook-assets.ts`). No wiring, provisioning,
  settings, or new files change — `worktree-prepare.ts` is untouched (its idempotent overwrite
  already delivers new templates to fresh AND kept worktrees on every dispatch;
  daemon-runner.ts:233 runs prepareWorktree per feature run).
- **Pre-dispatch uncertainty = abstain + loud.** In the inline `node -e` stamping block, the
  four silent `process.exit(0)` paths (status file read throw; `JSON.parse` throw;
  `!Array.isArray(parsed.tasks)`; temp-write/rename catch) each gain: best-effort
  `rmSync(currentTaskPath, { force: true })` + a stderr line with the stable prefix
  `pre-dispatch-hook: abstain —` naming the failure kind and the dispatched id, then exit 0
  (dispatch still proceeds — bookkeeping never blocks). Unknown-id exit 2, idempotent
  re-dispatch, overlap-guard clear-on-switch, and the success path are byte-for-byte
  unchanged in intent and covered by invariance tests.
- **prepare-commit-msg: single source of truth.** Delete the fallback block that scans
  `task-status.json` for a unique `in_progress` row (the `node -e` under the
  "Fall back to unique in_progress row" comment). Stamp from `.pipeline/current-task` or
  abstain. All existing abstentions (amend, rebase, no staged changes, existing trailer) and
  hook chaining unchanged.
- **commit-msg: validate real ids.** Replace `const tasks = data.tasks || {}; const ids =
  Object.keys(tasks)` with id extraction over the array rows —
  `(Array.isArray(data.tasks) ? data.tasks : []).map(t => String(t && t.id))` — comparing
  against the trailer id as a string (tolerates numeric seeded ids, the #501 drift class).
  Every exemption (merge, amend, rebase, `CONDUCT_ENGINE_COMMIT`), the task-N rejection, the
  empty-commit Evidence rules, the bundling warning, subject-mismatch warning, and chaining
  are unchanged and pinned by invariance tests.
- **Release gates:** no migration block needed — the diff touches no `hooks/` path, no
  settings schema, no CLI (release-gate.ts classifier verified); hook provisioning is
  engine-owned per-worktree infra (waiver precedent `.docs/release-waivers/
  deterministic-evidence-attribution.md`). CHANGELOG `[Unreleased]` Fixed entry required.
- **Test strategy:** behavior tests execute the GENERATED bash against fixture `.pipeline`
  dirs (`test/engine/session-hook-behavior.test.ts`); commit-time behavior runs in temp git
  repos with the generated hooks installed (`test/integration/git-hooks-attribution.test.ts`,
  `test/integration/session-hooks-attribution.test.ts`); provisioning parity via
  `test/engine/worktree-prepare.test.ts`. Vitest, always from `src/conductor` (never the
  worktree root), via `rtk proxy npx vitest run`.

## Prerequisites

- None. #509 enforcement (build-step-active marker) is merged and armed; this plan only
  composes with it.

## Tasks

### Task 1: Pre-dispatch abstains loudly when the status file is unreadable
**Story:** Story 1 (missing status file happy path; no-stamp negative)
**Type:** happy-path

**Steps:**
1. Write failing tests: generated pre-dispatch script run against a fixture where
   `.pipeline/current-task` contains `1` and `task-status.json` is ABSENT, dispatch line
   `Task: 2` → assert exit 0, stamp file gone, stderr matches
   `pre-dispatch-hook: abstain — task-status.json unreadable (dispatch Task: 2)`. Second
   test: same but NO stamp exists → exit 0, no stamp created, diagnostic still present.
2. Verify RED.
3. Implement: in `PRE_DISPATCH_HOOK`'s node block, replace the silent `process.exit(0)` in
   the `readFileSync(statusPath)` catch with stamp removal + the stderr diagnostic
   (share one `abstain(reason)` helper inside the inline script for all four paths).
4. Verify GREEN.
5. Commit: "fix(hooks): pre-dispatch abstains loudly when task-status.json is unreadable"

**Files:**
- src/conductor/src/engine/session-hook-assets.ts — harden read-failure path
- src/conductor/test/engine/session-hook-behavior.test.ts — uncertainty-path tests

**Dependencies:** none

### Task 2: Pre-dispatch abstains loudly on unparseable or wrong-shaped status file
**Story:** Story 1 (invalid JSON + wrong-shape happy paths)
**Type:** happy-path

**Steps:**
1. Write failing tests: stamp `1` + status file `{oops` → exit 0, stamp removed, stderr
   names parse failure; stamp `1` + `{"tasks": {"1": {}}}` (object, not array) → exit 0,
   stamp removed, stderr names shape failure.
2. Verify RED.
3. Implement: route the `JSON.parse` catch and the `!Array.isArray(parsed.tasks)` guard
   through the same abstain helper with distinct reason strings.
4. Verify GREEN.
5. Commit: "fix(hooks): pre-dispatch abstains loudly on unparseable or wrong-shaped task-status"

**Files:**
- src/conductor/src/engine/session-hook-assets.ts — harden parse/shape paths
- src/conductor/test/engine/session-hook-behavior.test.ts — parse/shape tests

**Dependencies:** 1

### Task 3: Pre-dispatch abstains loudly when the atomic status write fails
**Story:** Story 1 (write-failure happy path)
**Type:** negative-path

**Steps:**
1. Write failing test: stamp `1`, healthy status file seeding ids `1..3`, `.pipeline` made
   read-only after fixture setup (chmod 555) so the temp-write/rename in the switch path
   fails on dispatch `Task: 2` → assert exit 0 and stderr names the write failure; stamp
   removal is attempted (assert stamp gone, or if removal also fails on the read-only dir,
   assert the diagnostic reports the removal failure). Restore permissions in teardown.
2. Verify RED.
3. Implement: route the write/rename catch through the abstain helper (removal
   best-effort; a removal error is itself reported to stderr, never thrown).
4. Verify GREEN.
5. Commit: "fix(hooks): pre-dispatch abstains loudly when the status write fails"

**Files:**
- src/conductor/src/engine/session-hook-assets.ts — harden write-failure path
- src/conductor/test/engine/session-hook-behavior.test.ts — write-failure test

**Dependencies:** 2

### Task 4: Pre-dispatch healthy paths are invariant (no new diagnostics, unknown-id still blocks)
**Story:** Story 1 (all five negative-path invariance scenarios)
**Type:** negative-path

**Steps:**
1. Write tests (some may pass immediately — they PIN invariance): healthy seed, no stamp,
   `Task: 2` → row flips in_progress, stamp = `2`, exit 0, stderr contains NO
   `pre-dispatch-hook: abstain` line; idempotent re-dispatch (stamp `2`, `Task: 2`) → stamp
   kept, no diagnostic; overlap (stamp `2`, `Task: 3`) → row 3 in_progress, stamp removed,
   exit 0; unknown id `Task: 99` → exit 2 with existing unknown-id message; `Task: none` →
   exit 0, state untouched.
2. Run: any RED here means a hardening edit leaked into a healthy path — fix the template,
   not the test.
3. Verify GREEN.
4. Commit: "test(hooks): pin pre-dispatch healthy-path invariance around abstain hardening"

**Files:**
- src/conductor/test/engine/session-hook-behavior.test.ts — invariance tests

**Dependencies:** 3

### Task 5: prepare-commit-msg abstains when the stamp is absent — fallback removed
**Story:** Story 3 (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing test: temp repo with generated hooks, NO stamp, status file with EXACTLY
   ONE `in_progress` row, non-empty commit without trailer → landed message carries NO
   `Task:` trailer. Keep/extend passing tests: stamp `2` → stamps `Task: 2`; existing
   trailer preserved; multi-in_progress abstains; amend/rebase abstain.
2. Verify RED (the one-row fixture currently gets stamped by the fallback).
3. Implement: delete the fallback block (the `node -e` scanning `in_progress` rows) from
   `PREPARE_COMMIT_MSG_HOOK`; stamp-read, guards, and chaining unchanged.
4. Verify GREEN.
5. Commit: "fix(hooks): prepare-commit-msg stamps from current-task or abstains — never guesses (#519)"

**Files:**
- src/conductor/src/engine/git-hook-assets.ts — remove fallback from prepare-commit-msg
- src/conductor/test/integration/git-hooks-attribution.test.ts — abstention tests

**Dependencies:** none

### Task 6: prepare-commit-msg exemption invariance
**Story:** Story 3 (negative paths: existing trailer, amend, rebase)
**Type:** negative-path

**Steps:**
1. Write/verify tests pinning: pre-trailered message unchanged (no overwrite,
   no double-stamp); amend (`COMMIT_SOURCE=commit`) abstains; in-progress rebase abstains;
   no-staged-changes abstains; chained repo hook still invoked when present.
2. Any RED → template regression from task 5; fix template.
3. Verify GREEN.
4. Commit: "test(hooks): pin prepare-commit-msg exemptions after fallback removal"

**Files:**
- src/conductor/test/integration/git-hooks-attribution.test.ts — exemption tests

**Dependencies:** 5

### Task 7: commit-msg accepts every real seeded id — including the last (#501)
**Story:** Story 4 (happy paths: id == N, mid-range id, numeric ids)
**Type:** happy-path

**Steps:**
1. Write failing tests: temp repo seeding string ids `1..16` → non-empty commit with
   `Task: 16` ACCEPTED (currently rejected: index set is 0..15); `Task: 7` accepted;
   numeric-id fixture (`"id": 3`) → `Task: 3` accepted.
2. Verify RED.
3. Implement: in `COMMIT_MSG_HOOK`, replace the `Object.keys(data.tasks || {})` check with
   `String(t.id)` extraction over the tasks array; compare trailer as string.
4. Verify GREEN.
5. Commit: "fix(hooks): commit-msg validates Task trailer against real seeded ids (#501)"

**Files:**
- src/conductor/src/engine/git-hook-assets.ts — real-id validation in commit-msg
- src/conductor/test/integration/git-hooks-attribution.test.ts — acceptance tests

**Dependencies:** none

### Task 8: commit-msg rejects out-of-set and index-shaped ids; exemptions invariant
**Story:** Story 4 (negative paths)
**Type:** negative-path

**Steps:**
1. Write tests: ids `1..16` + `Task: 17` → REJECTED with the existing "not found in
   task-status.json" message; non-numeric grammar fixture (ids `A.1`, `A.2`) + `Task: 0`
   (an array index) → REJECTED; `Task: task-3` → existing naming-drift rejection; MISSING
   status file + any trailer → accepted (tolerance unchanged); merge commit, amend, rebase
   replay, `CONDUCT_ENGINE_COMMIT=1` → each exempt before validation.
2. Verify RED where the index bug currently accepts `Task: 0`; others pin invariance.
3. Implement: none expected beyond task 7's edit; fix template if any invariant broke.
4. Verify GREEN.
5. Commit: "test(hooks): pin commit-msg rejection set and exemptions under real-id validation"

**Files:**
- src/conductor/test/integration/git-hooks-attribution.test.ts — rejection/exemption tests

**Dependencies:** 7

### Task 9: #519 cascade regression — a failed dispatch never inherits an earlier id
**Story:** Story 2 (all criteria)
**Type:** negative-path

**Steps:**
1. Write failing-against-old-templates integration test (three-dispatch sequence in one
   hook-provisioned temp repo): (a) healthy bookkeeping for `Task: 1`, commit → trailer
   `Task: 1`; (b) replace status file with wrong-shaped JSON, run pre-dispatch for
   `Task: 2` → exit 0 + abstain diagnostic + stamp REMOVED, commit → NO `Task:` trailer
   (and specifically NOT `Task: 1`); (c) restore healthy status file, pre-dispatch
   `Task: 3`, commit → trailer `Task: 3`. Assert per-commit trailer content across all
   three.
2. Verify the test FAILS when run against the pre-fix templates (git stash of tasks 1–5's
   edits or fixture copies of the old scripts) and PASSES against the hardened ones.
3. Commit: "test(hooks): #519 regression — bookkeeping failure abstains, never cascades a stale id"

**Files:**
- src/conductor/test/integration/session-hooks-attribution.test.ts — cascade regression

**Dependencies:** 3, 5

### Task 10: Loud-path composition — abstain, reject, self-stamp, accept
**Story:** Story 5 (all criteria)
**Type:** happy-path

**Steps:**
1. Write test: hook-provisioned repo with `.pipeline/build-step-active` present, no stamp:
   non-empty untrailered commit → REJECTED with the existing instructive message; retry
   with explicit `Task: 2` (valid id) → ACCEPTED; retry with `Task: 99` → REJECTED by
   real-id validation. Control: stamp `2` present → auto-stamped and accepted. Control: no
   build-step-active → untrailered commit accepted.
2. Verify GREEN end-to-end (RED only if composition breaks).
3. Commit: "test(hooks): abstain composes with #509 gate into loud reject then valid self-stamp"

**Files:**
- src/conductor/test/integration/git-hooks-attribution.test.ts — composition tests

**Dependencies:** 5, 8

### Task 11: Re-provisioning replaces stale hook copies; settings merge invariant
**Story:** Story 6 (all criteria)
**Type:** infrastructure

**Steps:**
1. Write tests: `prepareWorktree` on a dir already carrying OLD fixture copies of the three
   scripts → files overwritten (assert hardened markers present: `pre-dispatch-hook:
   abstain` prefix in pre-dispatch; NO `in_progress` scan in prepare-commit-msg; no
   `Object.keys` over tasks in commit-msg) and settings wiring still exactly one entry per
   hook; unrelated keys in `.claude/settings.local.json` survive; asset write failure stays
   fail-open (logged, not thrown).
2. Verify GREEN (provisioning code is unchanged — this pins delivery of new templates).
3. Commit: "test(provisioning): re-provisioning heals kept worktrees with hardened hook assets"

**Files:**
- src/conductor/test/engine/worktree-prepare.test.ts — re-provisioning tests

**Dependencies:** 3, 5, 8

### Task 12: CHANGELOG entry + full-suite verification
**Story:** all (release gate)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` → `### Fixed` entry: attribution abstain-or-loud
   hardening — pre-dispatch bookkeeping failures abstain loudly instead of leaving a stale
   `current-task` (fixes #519); prepare-commit-msg no longer guesses from `in_progress`
   rows; commit-msg validates `Task:` trailers against real seeded ids instead of array
   indices (fixes #501). No migration block (no hook-wiring/settings/CLI path touched).
2. Run the full conductor suite from `src/conductor` (`rtk proxy npx vitest run`) and
   `test/test_harness_integrity.sh` from the worktree root; fix any fallout.
3. Commit: "docs(changelog): abstain-or-loud attribution hardening (#519, #501)"

**Files:**
- CHANGELOG.md — Unreleased Fixed entry

**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11

## Task Dependency Graph

```
1 ─▶ 2 ─▶ 3 ─▶ 4 ──────────────┐
              │                │
              ├──────▶ 9 ◀── 5 ─▶ 6 ─────┐
              │                │         │
              ├──▶ 11 ◀── 8 ◀─ 7         ├─▶ 12
              │        ▲      │          │
              │        │      └─▶ 10 ◀───┘
              └────────┴─── (9,10,11 fan into 12 with all others)
```

Streams: {1→2→3→4} (session-hook-assets), {5→6} (prepare-commit-msg), {7→8} (commit-msg) are
independent; 9 needs {3,5}; 10 needs {5,8}; 11 needs {3,5,8}; 12 needs all.

## Integration Points

- After Task 5: the #519 shape is fixed end-to-end for commit-time behavior (stale stamp
  impossible after 3; guess impossible after 5) — Task 9 proves it.
- After Task 8: the full loud path (abstain → reject → self-stamp → real-id accept) is live —
  Task 10 proves it.

## Coverage

- Story 1 → Tasks 1, 2, 3 (four uncertainty paths), 4 (five invariance scenarios)
- Story 2 → Task 9 (all three scenarios in one sequence test)
- Story 3 → Tasks 5 (happy + one-row abstention), 6 (exemptions)
- Story 4 → Tasks 7 (acceptance incl. id == N, numeric), 8 (rejections + exemptions)
- Story 5 → Task 10 (reject/self-stamp/controls)
- Story 6 → Task 11 (re-provision, dedup, fail-open, merge-preserve)

## Verification

- [ ] All happy path criteria covered by at least one task (mapping above)
- [ ] All negative path criteria covered by explicit tasks (4, 6, 8, 9, 10)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No new enforcement surfaces; hooks remain pure bash + inline node -e; provisioning
      fail-open unchanged
