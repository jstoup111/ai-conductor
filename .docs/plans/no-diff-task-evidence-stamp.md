# Implementation Plan: No-diff task earns completion currency deterministically

**Date:** 2026-07-21
**Issue:** #733 — "Build stall no_task_progress (N→N) on no-diff verification/skip tasks — auto-parked after 3 attempts (5 of 6 batch builds)"
**Stem:** `no-diff-task-evidence-stamp`
**Stories:** `.docs/stories/no-diff-task-evidence-stamp.md`
**Complexity:** `.docs/complexity/no-diff-task-evidence-stamp.md` (Tier: M)
**ADR:** `.docs/decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md` (APPROVED)
**Conflict check:** `.docs/conflicts/no-diff-task-evidence-stamp.md`
**Architecture:** `.docs/architecture/no-diff-task-evidence-stamp.md`
**Track:** technical (no PRD)
**Relates to:** #677 (`adr-2026-07-17-verify-only-judged-closure`), #707, #463, #188.

## Summary

The build completion gate accepts only an `evidenceStamps` entry as "resolved"
(`artifacts.ts:1024-1036`). A **no-diff** task — a "GREEN + full-suite check" verification,
or an already-satisfied contract closed as skipped — has no deterministic route to that
stamp, so it stalls `no_task_progress (N→N)` and auto-parks (5 of 6 builds on 2026-07-21).
Close the two holes with edits confined to `autoheal.ts`:

- **Edit A** — the `Evidence: skipped` branch of `deriveCompletionInternal` mints an
  `evidenceStamps` entry (`form: 'evidence:skipped'`) keyed to the skip commit, so the gate
  counts a skipped task resolved (reconciling it with `countResolvedTasks`).
- **Edit B** — `parsePlanTaskVerifyOnly` recognizes `**Type:** verification` as
  verify-only-eligible, in union with the existing `**Verify-only:** yes` marker, so the
  judged-closure lane arms for verification tasks (single edit; both consumers —
  `conductor.ts` arming and `attribution-lane.ts` path-relaxation — are unchanged).

Both stay git-derived and fail-closed (see ADR "Consequences").

## Technical approach

`deriveCompletionInternal` (`autoheal.ts:641`) already, in its `Evidence: skipped` arm
(lines 747-753), extracts the reason and sets `status:'skipped'` before `continue`. Add the
stamp there against `evidenceCommit.sha`. `parsePlanTaskVerifyOnly` (`autoheal.ts:1426`)
loops task blocks matching a `**Type:**` line; add a `TYPE_LINE` regex sibling to
`VERIFY_ONLY_LINE` and set the task true when the type value contains `verification`. No
consumer edit: `conductor.ts:3289` and `attribution-lane.ts:511` already read this map.

## Tasks

### Task 1: `Evidence: skipped` mints a stamp
**Story:** FR-1
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests in `autoheal.test.ts`: `deriveCompletion` over a branch with an
   `Evidence: skipped <reason>` commit for task T sets `evidenceStamps[T] = { sha:<skip
   commit>, form:'evidence:skipped' }` while derived `status` stays `skipped` /
   `completed:false`; a branch with **no** such commit leaves T absent from
   `evidenceStamps` (derive-from-git).
2. RED → in `deriveCompletionInternal`'s `Evidence: skipped` arm (`autoheal.ts:747-753`),
   add `evidence.evidenceStamps.set(taskId, { sha: evidenceCommit.sha, form: 'evidence:skipped' })`
   before `continue` → GREEN.
3. Commit: "fix(evidence-gate): Evidence: skipped commits mint an evidenceStamps entry (#733)"
**Files:** `src/conductor/src/engine/autoheal.ts`
**Wired-into:** `src/conductor/src/engine/artifacts.ts` build predicate (reads `evidenceStamps.has(id)`, unchanged)
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, `src/conductor/test/engine/autoheal.test.ts`
**Dependencies:** none

### Task 2: `**Type:** verification` is verify-only-eligible
**Story:** FR-2
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests in `autoheal.test.ts`: `parsePlanTaskVerifyOnly` returns `true` for a task
   whose `**Type:**` line contains `verification`, `true` for `**Verify-only:** yes`
   (unchanged), and `false` for `happy-path`/`negative-path`/`refactor`/`feature`/
   `integration`/`infrastructure`/`review` (fail-closed).
2. RED → add a `TYPE_LINE` regex beside `VERIFY_ONLY_LINE` (`autoheal.ts:1231`) and, in
   `parsePlanTaskVerifyOnly` (`autoheal.ts:1426-1456`), set the current ids `true` when the
   type value's `+`-split tokens include `verification` → GREEN. Update the function's
   doc-comment to state the union semantics (marker OR verification type).
3. Commit: "fix(evidence-gate): recognize Type: verification tasks as verify-only-eligible (#733)"
**Files:** `src/conductor/src/engine/autoheal.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts` lane arming (line 3289 region) + `src/conductor/src/engine/attribution-lane.ts` path-relaxation (line 511) — both consume the map unchanged
**Files likely touched:** `src/conductor/src/engine/autoheal.ts`, `src/conductor/test/engine/autoheal.test.ts`
**Dependencies:** none

### Task 3: Whitewash + own-diff-ordering guards under the widened eligibility
**Story:** FR-4, FR-5
**Type:** negative-path
**Steps:**
1. Failing tests in `attribution-lane.test.ts`: a `satisfied` verdict for a
   `Type: verification` residue task with a forged/non-ancestor citation yields **no**
   `semantic-verified` stamp (refused); an empty-citation / failing-`testEvidence` verdict
   coerces to `no-verdict` (whitewash guard) — re-asserted with the task marked eligible via
   `Type: verification` rather than `**Verify-only:** yes`.
2. Failing test (in `autoheal.test.ts` or `artifacts.test.ts`): a task with a real
   Task-trailered commit overlapping its declared paths is stamped via the trailer path and
   is **absent** from the residue set the lane would judge (own-diff-before-lane ordering).
3. RED → confirm the Task 1/2 edits already satisfy these (no new production code expected;
   if a gap surfaces, fix it here) → GREEN.
4. Commit: "test(evidence-gate): guard whitewash refusal + own-diff ordering under Type: verification (#733)"
**Files:** `src/conductor/test/engine/attribution-lane.ts`
**Wired-into:** none
**Files likely touched:** `src/conductor/test/engine/attribution-lane.test.ts`, `src/conductor/test/engine/autoheal.test.ts`
**Dependencies:** Task 1, Task 2

### Task 4: End-to-end — the #733 stall shape reaches gate-pass
**Story:** FR-6
**Type:** happy-path + negative-path
**Steps:**
1. Failing acceptance test reproducing the stall: a plan whose final task is a no-diff
   `Type: verification` "GREEN + full-suite check", plus a mid-plan `**Verify-only:** yes`
   task closed via `Evidence: skipped`. Baseline (Task-1/2 edits reverted in the fixture, or
   asserted against pre-fix behavior) → the build predicate reports
   `1/N tasks pending/not completed`; with the skip commit + a valid verdict present →
   predicate returns `done: true`. Assert `countResolvedTasks` and task-status seeding are
   untouched.
2. RED → GREEN (satisfied by Tasks 1-2; test only) .
3. Commit: "test(evidence-gate): acceptance — #733 no-diff stall shape builds to gate-pass"
**Files:** `src/conductor/test/acceptance/verify-only-prove-closed-task-evidence.acceptance.test.ts`
**Wired-into:** none
**Files likely touched:** `src/conductor/test/acceptance/verify-only-prove-closed-task-evidence.acceptance.test.ts` (add cases) or a new `no-diff-task-evidence-stamp.acceptance.test.ts`
**Dependencies:** Task 1, Task 2

### Task 5: Docs + CHANGELOG (docs-track-features)
**Story:** all
**Type:** happy-path
**Steps:**
1. `src/conductor/README.md`: in the evidence-gate / verify-only section, document that a
   no-diff task earns completion currency two ways — an `Evidence: skipped` commit, or a
   task typed `**Type:** verification` (recognized alongside `**Verify-only:** yes`) judged
   through the closure lane. `README.md`: one-line note if it references the evidence gate.
2. `CHANGELOG.md` under `## [Unreleased]` → **Fixed**: no-diff verification/skip tasks no
   longer auto-park with `no_task_progress` — `Evidence: skipped` commits are stamped and
   `Type: verification` tasks arm the judged-closure lane (#733). No `## Migration` block:
   internal engine behavior only, no `bin/conduct` CLI, hook, or `settings.json` change.
3. Commit: "docs(evidence-gate): document no-diff task completion currency (#733)"
**Files:** `src/conductor/README.md`
**Wired-into:** none
**Files likely touched:** `src/conductor/README.md`, `README.md`, `CHANGELOG.md`
**Dependencies:** Task 1, Task 2

### Task 6: GREEN + full-suite check
**Story:** all
**Type:** verification
**Verify-only:** yes
**Steps:**
1. Run `rtk proxy npx vitest run test/engine/autoheal.test.ts test/engine/attribution-lane.test.ts test/engine/artifacts.test.ts` in `src/conductor` (each worktree needs its own `npm install`); run the acceptance test from Task 4; run the broader engine suite if quick.
2. Run `test/test_harness_integrity.sh` from the repo root (green).
3. Keep diffs minimal.
**Files:** `src/conductor/src/engine/autoheal.ts`
**Wired-into:** none
**Dependencies:** 1, 2, 3, 4, 5

## Files likely touched

- `src/conductor/src/engine/autoheal.ts` — Edit A (`deriveCompletionInternal` skip branch,
  ~line 750) + Edit B (`TYPE_LINE` regex ~line 1231 and `parsePlanTaskVerifyOnly` ~line
  1446).
- `src/conductor/test/engine/autoheal.test.ts` — skip-stamp + verify-only-eligibility +
  derive-from-git-negative tests.
- `src/conductor/test/engine/attribution-lane.test.ts` — whitewash-refusal guard under
  `Type: verification`.
- `src/conductor/test/engine/artifacts.test.ts` — build-predicate resolution for a skipped
  task (optional, if not covered by the acceptance test).
- `src/conductor/test/acceptance/verify-only-prove-closed-task-evidence.acceptance.test.ts`
  — the #733 end-to-end stall-shape case (or a new sibling acceptance test).
- `src/conductor/README.md`, `README.md`, `CHANGELOG.md` — docs + `[Unreleased]` entry.

(`src/conductor/src/engine/conductor.ts` and `attribution-lane.ts` are intentionally NOT
edited — they already consume `parsePlanTaskVerifyOnly`; Edit B propagates through them
unchanged. `task-progress.ts` `countResolvedTasks` is intentionally NOT touched.)

## Verification

- Acceptance test (Task 4) replays the #733 stall and asserts gate-pass after the fix.
- Negative paths (Task 3): forged/non-ancestor citation still refused; non-`verification`
  Type stays fail-closed; own-diff tasks resolve before the lane.
- `test/test_harness_integrity.sh` green.
