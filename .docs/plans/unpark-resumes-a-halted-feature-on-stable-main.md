# Implementation Plan: unpark names the live HALT it leaves behind (#822)

**Date:** 2026-09-24
**Stories:** .docs/stories/unpark-resumes-a-halted-feature-on-stable-main.md
**Conflict check:** Not required (Tier S)

## Summary

`ai-conductor daemon unpark <slug>` keeps its park-only behavior, but when the slug's worktree holds a live `.pipeline/HALT` it stops promising a resume. Instead it prints a warning and the recovery that fits `.pipeline/HALT.class`. The warning appears in both the unparked branch and the never-parked branch. 3 tasks.

## Technical Approach

- **One pure reader.** Add `describeLiveHalt(worktreePath): Promise<string[] | null>` in a new `src/conductor/src/engine/unpark-halt-warning.ts`. It returns `null` when `<worktreePath>/.pipeline/HALT` does not exist. Otherwise it returns two lines: a warning line and a recovery line. It never writes. Import the path constants `HALT_MARKER`, `HALT_CLASS_MARKER`, `PLAN_GAP_HALT_CLASS` and `PROTECTED_ARTIFACT_HALT_CLASS` from `halt-marker.ts`, and `KICKBACK_CAP_HALT_CLASS` and `OVER_SCOPE_HALT_CLASS` from `halt-classification.ts`. Do not import `daemon-rekick.ts`: it pulls the rebase machinery into the pre-boot CLI path.
- **Why not `readRawHaltClass`.** Verified no-fit: `readRawHaltClass` (`daemon-rekick.ts`) returns `''` for every read error, so an unreadable sidecar would look absent and get the remove-both recovery. Story 1 requires unreadable to fail toward resolve-first. `describeLiveHalt` reads `HALT.class` itself. ENOENT gives class label `unclassified`; any other read error gives `unreadable`; otherwise the label is the trimmed text, and an empty trimmed text gives `(empty)`.
- **Warning line** (exact text, which the tests assert as substrings): `'<slug>' still has a live HALT (class: <label>) — it will not resume until the HALT is cleared.` The slug is the worktree directory's basename.
- **Recovery line, by class label** (`<wt>` is the absolute worktree path):
  - `mechanical`, `legacy`, `unclassified` → `To resume: rm <wt>/.pipeline/HALT <wt>/.pipeline/HALT.class`
  - `over-scope` → `To resume: record each decision in <wt>/.pipeline/HALT, then mv <wt>/.pipeline/HALT <wt>/.pipeline/HALT.cleared`
  - `kickback-cap` → `To resume: ai-conductor kickback-budget inspect --feature <slug>, then raise or reset the budget; the daemon clears the HALT.`
  - every other label, including `needs-human`, `plan-gap`, `protected-artifact`, `unreadable`, `(empty)` and any unknown text → `To resume: resolve the cause recorded in <wt>/.pipeline/HALT before the HALT is cleared — see docs/runbooks/stalled-or-stuck-feature.md`
  - No line except the remove-both line contains `rm `.
- **Wiring.** Both changes are in the `unpark` branch of `dispatchDaemonPark` (`src/conductor/src/engine/daemon-park-cli.ts`).
  - Parked branch: when the worktree exists, call `describeLiveHalt(worktreeDir)`. If it returns lines, print `Unparked '<slug>' and reset no-evidence counter.` followed by those lines, instead of today's `… — normal dispatch and re-kick resume.` line. With no HALT, and on the worktree-missing fallback, the output is unchanged.
  - Never-parked branch: after `was not operator-parked — nothing to do.`, print the lines only when the worktree exists and `describeLiveHalt` returns non-null. Do not reset the counter or write the marker.
  - The ordering "reset counter, then remove marker" is unchanged.
- **Tests.** Extend `src/conductor/test/engine/daemon-park-cli.test.ts`, whose `dispatchDaemonPark` suite already uses a tmp `root`, `makeWorktree`, and captured `out` lines (search `unpark on a slug that was never parked`). Add a sibling `src/conductor/test/engine/unpark-halt-warning.test.ts` for the reader. Create an unreadable sidecar by making a directory at the `.pipeline/HALT.class` path. Assert byte identity by reading each file's `Buffer` before and after the call. Use no real daemon and no git remote.

## Prerequisites

- None.

## Tasks

### Task 1: `describeLiveHalt` maps a live HALT's class to its recovery
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/unpark-halt-warning.test.ts`, one per fixture: no HALT; HALT plus each class `mechanical`, `legacy`, `over-scope`, `kickback-cap`, `needs-human`, `plan-gap`, `protected-artifact`, `future-class`; an empty sidecar; an absent sidecar; and a directory at the sidecar path. Assert the exact warning and recovery lines from Technical Approach, and assert that the `.pipeline/` bytes are unchanged.
2. Verify RED (the module does not exist).
3. Implement `describeLiveHalt` in `src/conductor/src/engine/unpark-halt-warning.ts` as described in Technical Approach. Read `HALT.class` directly and distinguish ENOENT from other errors; do not reuse `readRawHaltClass` (verified no-fit: it collapses read errors to absent). Import the class constants from `halt-marker.ts` and `halt-classification.ts`, not `daemon-rekick.ts`.
4. Verify GREEN; commit.

**Done when:**
- `describeLiveHalt` returns `null` when `.pipeline/HALT` is absent from the given worktree, as asserted by the no-HALT unit test.
- For HALT.class fixtures `mechanical`, `legacy`, and an absent sidecar, `describeLiveHalt` returns a warning line naming the class (`unclassified` for the absent sidecar) and a `To resume: rm` line naming both `.pipeline/HALT` and `.pipeline/HALT.class`.
- For `over-scope` it returns a line containing `mv` and `.pipeline/HALT.cleared`; for `kickback-cap` a line containing `ai-conductor kickback-budget inspect --feature <slug>`; for `needs-human`, `plan-gap`, `protected-artifact`, `future-class`, an empty sidecar, and a directory at the `.pipeline/HALT.class` path it returns the resolve-first line naming `docs/runbooks/stalled-or-stuck-feature.md`; none of these contain `rm `.
- The directory-at-sidecar-path fixture yields class label `unreadable` and the resolve-first line, proving `describeLiveHalt` distinguishes ENOENT from other read errors instead of collapsing both to absent the way `readRawHaltClass` does.
- The unit tests snapshot every file under the fixture `.pipeline/` before and after each call and assert the bytes and file set are identical (`describeLiveHalt` performs no writes).

**Files likely touched:**
- src/conductor/src/engine/unpark-halt-warning.ts — new pure reader
- src/conductor/test/engine/unpark-halt-warning.test.ts — unit tests

**Dependencies:** none

### Task 2: Unparking a parked feature with a live HALT prints the class-specific recovery
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/daemon-park-cli.test.ts` inside the `dispatchDaemonPark` suite. Use an `it.each` table over the ten class fixtures: operator-park the slug via `dispatchDaemonPark({ kind: 'park' })`, create `.worktrees/<slug>/.pipeline/HALT`, the class sidecar (a directory for the unreadable row) and a seeded `HALT.cleared`, then unpark with captured `out`. Assert exit code, marker state, output substrings, the absence of `rm ` where required, byte identity, and that `.pipeline/REKICK` is absent. Add the no-HALT and worktree-missing cases asserting unchanged output.
2. Verify RED (today the output always says `normal dispatch and re-kick resume`).
3. Implement: in the parked branch of `dispatchDaemonPark`, when the worktree exists, call `describeLiveHalt(worktreeDir)`. If it returns non-null, print `Unparked '<slug>' and reset no-evidence counter.` followed by the returned lines instead of the resume line. Leave the fallback branch and the reset-then-remove ordering unchanged.
4. Verify GREEN; commit.

**Done when:**
- `dispatchDaemonPark({ kind: 'unpark' })` on an operator-parked slug with a live HALT exits 0, leaves `isOperatorParked` false, and its output omits `normal dispatch and re-kick resume` and contains `will not resume until the HALT is cleared`, for every fixture in the task's it.each table (`mechanical`, absent sidecar, `legacy`, `over-scope`, `kickback-cap`, `needs-human`, `plan-gap`, `protected-artifact`, `future-class`, unreadable sidecar).
- In that table the output names the class (`unclassified` for the absent sidecar, the raw text otherwise), and the `mechanical`, absent-sidecar, and `legacy` rows contain an `rm` line naming both `.pipeline/HALT` and `.pipeline/HALT.class` under the slug's worktree.
- The `over-scope` row directs recording each decision in the HALT body and then an `mv` of `.pipeline/HALT` to `.pipeline/HALT.cleared`; the `kickback-cap` row names `ai-conductor kickback-budget`; the `needs-human`, `plan-gap`, `protected-artifact`, `future-class` (printed raw), and unreadable-sidecar rows state the cause recorded in the HALT body must be resolved before the HALT is cleared and name `docs/runbooks/stalled-or-stuck-feature.md`; the `over-scope`, `kickback-cap`, `future-class`, and unreadable-sidecar rows contain no `rm ` instruction.
- For every row, `.pipeline/HALT`, `.pipeline/HALT.class`, and a seeded `.pipeline/HALT.cleared` are byte-identical before and after unpark, and `.pipeline/REKICK` does not exist afterwards.
- An operator-parked slug with a worktree but no HALT, and one with no `.worktrees/<slug>` directory (worktree-missing fallback), each exit 0 with the park marker removed and output containing `normal dispatch and re-kick resume` and not containing `will not resume until the HALT is cleared`.

**Files likely touched:**
- src/conductor/src/engine/daemon-park-cli.ts — parked-branch warning
- src/conductor/test/engine/daemon-park-cli.test.ts — parked-branch cases

**Dependencies:** 1

### Task 3: Unparking a never-parked feature with a live HALT prints the recovery after "nothing to do"
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in the same `dispatchDaemonPark` suite for a slug with no park marker: live `mechanical` HALT, live `over-scope` HALT, no HALT, and no worktree. Seed `.pipeline/task-evidence.json` with `noEvidenceAttempts: 2` and a `HALT.cleared` in the live-HALT fixtures, then assert byte identity, that no park marker was created, and the exact captured lines.
2. Verify RED (today the branch prints only the `nothing to do` line).
3. Implement: in the not-parked branch, after the existing line, when `.worktrees/<slug>` exists, call `describeLiveHalt` and print its lines if non-null. Keep the early `return 0`, and never reset the counter or write the marker there.
4. Verify GREEN; commit.

**Done when:**
- `dispatchDaemonPark({ kind: 'unpark' })` on a slug with no park marker and a live `mechanical` HALT exits 0 and prints `was not operator-parked — nothing to do.` followed by exactly the lines `describeLiveHalt` returns for that worktree (warning naming `mechanical` plus the `rm` line naming `.pipeline/HALT` and `.pipeline/HALT.class`).
- The same call with a live `over-scope` HALT prints the `mv` line to `.pipeline/HALT.cleared` and its output contains no `rm ` instruction.
- For both live-HALT fixtures, `isOperatorParked` is false afterwards (no park marker created), a seeded `.pipeline/task-evidence.json` with `noEvidenceAttempts: 2` is byte-identical (counter not reset), and `.pipeline/HALT`, `.pipeline/HALT.class`, and a seeded `.pipeline/HALT.cleared` are byte-identical.
- A slug with no park marker and no HALT, and a slug with no park marker and no `.worktrees/<slug>` directory, each exit 0 with captured output deep-equal to the single line `'<slug>' was not operator-parked — nothing to do.` and no thrown error.

**Files likely touched:**
- src/conductor/src/engine/daemon-park-cli.ts — not-parked-branch warning
- src/conductor/test/engine/daemon-park-cli.test.ts — not-parked-branch cases

**Dependencies:** 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
```

Task 3 depends on Task 2 only because both edit `daemon-park-cli.ts` and its test file.

## Integration Points

- After Task 2: `ai-conductor daemon unpark <slug>` on a parked, halted feature prints the class-specific recovery through the real pre-boot dispatcher (`dispatchDaemonPark`), which Task 2 owns as the CLI entry-point integration.
- After Task 3: both unpark branches share the same warning.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an operator-parked slug whose worktree has a live HALT with class `mechanical`, when `ai-conductor daemon unpark <slug>` runs, then it exits 0, removes the park marker, omits the text `normal dispatch and re-kick resume`, prints that the feature will not resume until its HALT is cleared, names the class `mechanical`, and names removing both `.pipeline/HALT` and `.pipeline/HALT.class` in that worktree as the recovery. | 2 | "omits `normal dispatch and re-kick resume` and contains `will not resume until the HALT is cleared`" | diff-local |
| Story 1 happy: Given an operator-parked slug whose worktree has a live HALT with no `HALT.class` file, or with class `legacy`, when unpark runs, then the output names the class (`unclassified` for the absent file, `legacy` otherwise) and gives the same remove-both recovery as `mechanical`. | 2 | "the output names the class (`unclassified` for the absent sidecar, the raw text otherwise)" | diff-local |
| Story 1 happy: Given an operator-parked slug whose worktree has a live HALT with class `over-scope`, when unpark runs, then the output names the class, directs the operator to record each decision in the HALT body and then rename `.pipeline/HALT` to `.pipeline/HALT.cleared`, and contains no instruction to remove or delete `.pipeline/HALT`. | 2 | "an `mv` of `.pipeline/HALT` to `.pipeline/HALT.cleared`" | diff-local |
| Story 1 happy: Given an operator-parked slug whose worktree has a live HALT with class `kickback-cap`, when unpark runs, then the output names the class, names `ai-conductor kickback-budget` as the recovery command, and contains no instruction to remove or delete `.pipeline/HALT`. | 2 | "the `kickback-cap` row names `ai-conductor kickback-budget`" | diff-local |
| Story 1 happy: Given an operator-parked slug whose worktree has a live HALT with class `needs-human`, `plan-gap`, or `protected-artifact`, when unpark runs, then the output names the class, states that the cause recorded in the HALT body must be resolved before the HALT is cleared, and names the runbook path. | 2 | "must be resolved before the HALT is cleared and name `docs/runbooks/stalled-or-stuck-feature.md`" | diff-local |
| Story 1 happy: Given an operator-parked slug whose worktree has no live HALT, when unpark runs, then the output is unchanged from today: it still ends with `normal dispatch and re-kick resume` and prints no HALT warning. | 2 | "An operator-parked slug with a worktree but no HALT" | diff-local |
| Story 1 negative: Given an operator-parked slug with a live HALT of any class, when unpark runs, then `.pipeline/HALT`, `.pipeline/HALT.class`, and any `.pipeline/HALT.cleared` in that worktree are byte-identical before and after, and no re-kick sentinel file is created. | 2 | "`.pipeline/REKICK` does not exist afterwards" | diff-local |
| Story 1 negative: Given an operator-parked slug whose live HALT has a class text unpark does not recognize (for example `future-class`), when unpark runs, then the output prints that raw class text, gives the resolve-the-cause-first recovery with the runbook path, and contains no instruction to remove or delete `.pipeline/HALT`. | 2 | "`future-class` (printed raw)" | diff-local |
| Story 1 negative: Given an operator-parked slug whose live HALT has a `HALT.class` path that exists but cannot be read as a file, when unpark runs, then unpark still exits 0 and removes the park marker, and the warning gives the resolve-the-cause-first recovery with the runbook path rather than the remove-both recovery. | 2 | "unreadable-sidecar rows contain no `rm ` instruction" | diff-local |
| Story 1 negative: Given an operator-parked slug with no `.worktrees/<slug>` directory, when unpark runs, then it takes the existing worktree-missing fallback, exits 0, removes the park marker, and prints no HALT warning. | 2 | "one with no `.worktrees/<slug>` directory (worktree-missing fallback)" | diff-local |
| Story 2 happy: Given a slug with no park marker whose worktree has a live HALT with class `mechanical`, when unpark runs, then it exits 0, still prints `was not operator-parked — nothing to do.`, and follows it with the same HALT warning and class-specific recovery Story 1 prints for that class. | 3 | "prints `was not operator-parked — nothing to do.` followed by exactly the lines `describeLiveHalt` returns" | diff-local |
| Story 2 happy: Given a slug with no park marker whose worktree has a live HALT with class `over-scope`, when unpark runs, then the warning directs the rename to `.pipeline/HALT.cleared` and contains no instruction to remove or delete `.pipeline/HALT`. | 3 | "its output contains no `rm ` instruction" | diff-local |
| Story 2 happy: Given a slug with no park marker and no live HALT, when unpark runs, then the output is exactly today's single `was not operator-parked — nothing to do.` line. | 3 | "A slug with no park marker and no HALT" | diff-local |
| Story 2 negative: Given a slug with no park marker whose worktree has a live HALT, when unpark runs, then no park marker is created, the no-evidence counter is not reset, and the HALT, HALT.class, and HALT.cleared bytes are unchanged. | 3 | "`isOperatorParked` is false afterwards (no park marker created)" | diff-local |
| Story 2 negative: Given a slug with no park marker and no `.worktrees/<slug>` directory, when unpark runs, then it exits 0 and prints only the `nothing to do` line, with no error and no HALT warning. | 3 | "a slug with no park marker and no `.worktrees/<slug>` directory" | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
