# Implementation plan: prepare-commit-msg reconciles a wrong self-stamped `Task:` trailer

Source issue: jstoup111/ai-conductor#576
Track: technical · Tier: S

## Summary

Replace the prepare-commit-msg hook's blanket "trailer already present → `exit 0`"
early exit with a reconcile: read `.pipeline/current-task` first, and when it holds a
non-empty id that disagrees with the existing `Task:` trailer, overwrite the trailer
with the engine id (`interpret-trailers --in-place` replaces the known `Task:` key).
When current-task is absent, preserve the existing trailer. The engine's deterministic
id wins over a self-stamp, closing the #576 halt class without touching the #433
machinery.

## Design

- **Single source change:** the `PREPARE_COMMIT_MSG_HOOK` string template in
  `src/conductor/src/engine/git-hook-assets.ts` (lines 15–72). (The runtime
  `.pipeline/git-hooks/prepare-commit-msg` is generated from this constant at
  worktree-provision time — `worktree-prepare.ts:303` — and is gitignored, so it is
  NOT edited directly.)
- **Remove the early exit** at lines 38–41:
  ```sh
  if git interpret-trailers --parse < "$COMMIT_MSG_FILE" 2>/dev/null | grep -q '^Task:'; then
    exit 0
  fi
  ```
- **Reorder to reconcile.** After computing `TASK_ID` from `CURRENT_TASK_FILE`
  (existing lines ~44–51):
  - If `TASK_ID` is empty → leave the message untouched and exit 0 (preserve any
    existing trailer; Story 3a/3b — the manual-commit case).
  - If `TASK_ID` is non-empty → `git interpret-trailers --in-place --trailer
    "Task: $TASK_ID" "$COMMIT_MSG_FILE"`. Because `Task:` is a known single-value
    trailer key, `--in-place` **replaces** the existing `Task:` line rather than
    appending a duplicate — so a disagreeing trailer becomes the engine id (Story 1)
    and an agreeing one stays a single trailer (Story 2), and a no-trailer message
    gains one (Story 3c). This is the same stamp command already at lines ~54–56,
    now reached unconditionally when `TASK_ID` is present.
  - Keep the `if_missing`/replace semantics correct: verify with a test that a second
    disagreeing trailer is not appended (single `Task:` trailer remains). If the
    installed git's `interpret-trailers` default would append rather than replace for
    a repeated key, add `--if-exists replace` explicitly to the invocation.
- **No change required to `COMMIT_MSG_HOOK`.** The subject-vs-trailer warning
  (lines 266–274) becomes belt-and-suspenders once the engine id is authoritative; a
  secondary hardening (whole-message scan / blocking) is explicitly out of scope here.
- **No change to the #433 machinery or the current-task writers**
  (`session-hook-assets.ts:171`, `task-cli.ts:153`) — they already write the
  authoritative id.

## Prerequisites

- None. The hook already reads `.pipeline/current-task`; only the control flow changes.

## Tasks

### Task 1: Reconcile the trailer in the prepare-commit-msg template
**Story:** Story 1 + Story 2 + Story 3
**Type:** happy-path
**Steps:**
1. In `src/conductor/test/integration/git-hooks-attribution.test.ts`, INVERT the
   bug-codifying case at lines 91–98 ("does not overwrite an already-present Task:
   trailer"): rename/rewrite it so `current-task = 7` + self-stamped `Task: 9` yields
   `Task: 7` and NOT `Task: 9`. Add a body-only-reference variant (Story 1b). Verify RED.
2. In `git-hook-assets.ts`, remove the early exit (lines 38–41) and restructure so the
   `TASK_ID`-present branch runs `interpret-trailers --in-place --trailer "Task: $TASK_ID"`
   unconditionally (add `--if-exists replace` if needed for replace semantics), while an
   empty `TASK_ID` leaves the message untouched.
3. Verify GREEN.
**Files:** `src/conductor/src/engine/git-hook-assets.ts`, `src/conductor/test/integration/git-hooks-attribution.test.ts`
**Wired-into:** `src/conductor/src/engine/worktree-prepare.ts` (writes the generated hook at provision time — unchanged consumer)
**Dependencies:** none

### Task 2: Idempotence + agreeing-trailer no-op
**Story:** Story 2a
**Type:** happy-path
**Steps:**
1. Add an integration case: `current-task = 10` + existing `Task: 10` → exactly one
   `Task: 10` trailer after the hook (no duplicate). Verify RED/GREEN against Task 1.
**Files:** `src/conductor/test/integration/git-hooks-attribution.test.ts`
**Wired-into:** none
**Dependencies:** 1

### Task 3: Absent current-task preserves the trailer; present-with-no-trailer still stamps
**Story:** Story 3a + Story 3b + Story 3c
**Type:** negative-path
**Steps:**
1. Add integration cases: (a) no current-task + `Task: 9` present → `Task: 9` preserved;
   (b) no current-task + no trailer → no trailer added; (c) `current-task = 3` + no
   trailer → `Task: 3` stamped (regression of the original deterministic stamp path).
2. Verify GREEN against Task 1.
**Files:** `src/conductor/test/integration/git-hooks-attribution.test.ts`
**Wired-into:** none
**Dependencies:** 1

### Task 4: Lock the hook string (syntax + no-dist regression)
**Story:** all
**Type:** verification
**Steps:**
1. Update/extend `src/conductor/test/engine/git-hook-assets.test.ts` so the
   `bash -n` syntax check and any hook-content regression locks cover the new
   reconcile lines; add a targeted assertion that the template no longer contains the
   unconditional `exit 0`-on-any-trailer early exit.
2. Verify GREEN.
**Files:** `src/conductor/test/engine/git-hook-assets.test.ts`
**Wired-into:** none
**Dependencies:** 1

### Task 5: GREEN + full-suite check
**Story:** all
**Type:** verification
**Steps:**
1. Run `rtk proxy npx vitest run test/integration/git-hooks-attribution.test.ts test/engine/git-hook-assets.test.ts` in `src/conductor` (each worktree needs its own `npm install`).
2. Keep diffs minimal; confirm no adjacent hook test (`session-hooks-attribution.test.ts`) regressed.
**Files:** `src/conductor/src/engine/git-hook-assets.ts`
**Wired-into:** none
**Dependencies:** 1, 2, 3, 4

## Files likely touched

- `src/conductor/src/engine/git-hook-assets.ts` — the `PREPARE_COMMIT_MSG_HOOK` template
  (remove early exit; reconcile via `interpret-trailers --in-place`).
- `src/conductor/test/integration/git-hooks-attribution.test.ts` — invert the
  bug-codifying case (lines 91–98) + add reconcile/idempotence/absent cases.
- `src/conductor/test/engine/git-hook-assets.test.ts` — hook-string syntax + regression lock.

## Verification

- [ ] current-task present + disagreeing trailer → trailer overwritten with engine id (single `Task:`).
- [ ] Agreeing trailer → idempotent no-op (no duplicate).
- [ ] current-task absent → existing trailer preserved; no trailer added when none present.
- [ ] current-task present + no trailer → still stamped (original path intact).
- [ ] git-hooks-attribution + git-hook-assets suites green; harness integrity suite green.

## Out of scope

- Hardening `COMMIT_MSG_HOOK`'s subject-vs-trailer check to scan the whole message or
  to block (it becomes redundant once the engine id is authoritative) — a separate,
  optional follow-up.
- Any change to the #433 attribution engine, autoheal path-corroboration, or the
  `.pipeline/current-task` writers.
- The distinct #519 (frozen current-task) and #485 (parser-invisible Task line) defects.
