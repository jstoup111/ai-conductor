# Track: prepare-commit-msg reconciles a wrong agent-self-stamped `Task:` trailer

Track: technical

## Why technical

This is a defect fix in the deterministic attribution hook (the `prepare-commit-msg`
git hook). No user-facing product surface, no PRD-worthy behavior — the acceptance
criteria are mechanical (when a `Task:` trailer disagrees with the engine's
`.pipeline/current-task`, the engine value wins). Acceptance criteria live in the
stories, not a PRD.

## Context (verified against `main`)

#433 established deterministic engine-stamped attribution: the engine writes the
authoritative task id to `.pipeline/current-task` at dispatch, and the
`prepare-commit-msg` hook stamps `Task: <id>` from it — so attribution does not depend
on agent prompt discipline. The defect: the hook only stamps **when no `Task:` trailer
is already present**, so a wrong trailer the agent hand-typed survives.

The hooks are **templated in TypeScript**, not tracked at `.pipeline/` (that runtime
dir is gitignored). The tracked source is
`src/conductor/src/engine/git-hook-assets.ts`:

- `PREPARE_COMMIT_MSG_HOOK` (lines 15–72). The root-cause early exit is lines 38–41:

  ```sh
  # Check if a Task: trailer already exists
  if git interpret-trailers --parse < "$COMMIT_MSG_FILE" 2>/dev/null | grep -q '^Task:'; then
    exit 0
  fi
  ```

  It exits on **any** `^Task:` trailer without comparing it to `.pipeline/current-task`.
  The deterministic id is read just below (lines ~44–51, `CURRENT_TASK_FILE` →
  `TASK_ID`) and stamped via `git interpret-trailers --in-place --trailer "Task: $TASK_ID"`
  (lines ~54–56) — but that code never runs because the early exit short-circuits first.

- `COMMIT_MSG_HOOK` (lines 88–291). Its only guard for this shape is a subject-vs-trailer
  mismatch warning (lines 266–274) that scans **only `head -1`** (the subject) and is
  **warn-only** (`echo … WARNING`, never `exit 1`). Both offending commits in the live
  incident carried their correct reference ("Task 10:", "Task 14") in the **body**, so
  this check never saw them.

The engine's source of truth is confirmed written before commit time:
`src/conductor/src/engine/session-hook-assets.ts:171` (`writeFileSync(currentTaskPath, id)`)
and `src/conductor/src/engine/task-cli.ts:153` — so at `prepare-commit-msg` time the
engine already knows the right id.

Live incident (#499 build): commits `64faf41` (task 10) and `a019aaf` (task 14) carried
`Task: 12` and `Task: 15`; autoheal path-corroboration correctly rejected the wrong
attribution, but only after the daemon burned all retries → HALT.

The existing integration test **codifies the bug**
(`src/conductor/test/integration/git-hooks-attribution.test.ts:91-98`): with
`current-task = 7` and a self-stamped `Task: 9`, it asserts `Task: 9` survives and
`Task: 7` does not — exactly the failure. The fix must invert this case.

## Approaches considered

1. **Reconcile in `prepare-commit-msg`: read `current-task` first; if a trailer exists,
   `current-task` is non-empty, and they disagree, overwrite the trailer with the
   engine value (chosen).** Replace the blanket `exit 0` (lines 38–41) with: read
   `TASK_ID` from `.pipeline/current-task`; if `TASK_ID` is empty → keep whatever
   trailer exists (preserve today's behavior for manual commits outside a dispatched
   task); if `TASK_ID` is non-empty → `git interpret-trailers --in-place --trailer
   "Task: $TASK_ID"` (the `Task:` key is known, so `--in-place` **replaces** the
   existing trailer, not append). Engine determinism wins over a self-stamp. No change
   to the #433 machinery.

2. **Make `commit-msg` block on a body-or-subject mismatch.** Rejected as the primary
   fix: it is a downstream *detector* that would only HALT harder (reject the commit),
   not self-repair; the engine already has the right id, so the correct move is to
   stamp it, not to reject. (A secondary hardening — widen the warning beyond `head -1`
   — is noted as optional, out of the core scope.)

3. **Strip agent-authored trailers entirely and always re-stamp.** Rejected: over-broad;
   when `current-task` is absent (legitimate manual commits) there is nothing to stamp,
   and clobbering a human's deliberate trailer with nothing is wrong. Approach 1's
   "only override when `current-task` disagrees and is present" is the precise fix.

Decision: **Approach 1.**
