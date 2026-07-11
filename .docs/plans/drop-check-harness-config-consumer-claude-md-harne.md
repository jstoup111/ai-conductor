# Implementation Plan: Drop check_harness_config

**Date:** 2026-07-05
**Track:** technical (Tier S) — see `.docs/track/drop-check-harness-config-consumer-claude-md-harne.md`
**Stories:** `.docs/stories/drop-check-harness-config-consumer-claude-md-harne.md`
**Conflict check:** N/A — skipped for Tier S

## Summary
Delete the `check_harness_config` bash function and its launch-time call from `bin/conduct`, then
reconcile the docs that advertise it. 5 tasks. No TS is added — the decision is to DROP (not port);
detection of a missing HARNESS.md reference is retained by `hooks/claude/session-start-context.sh`.

## Technical Approach
`check_harness_config()` (`bin/conduct:466-505`) auto-appends a HARNESS.md reference block to a
consumer's `CLAUDE.md` and `git commit`s it at launch (call site `bin/conduct:2897`). This
auto-commit-to-consumer behavior is the only thing unique to it — the *detection* (warn + print the
block to add) is already done every session by `hooks/claude/session-start-context.sh:30`. So the
change is a pure removal plus a documentation correction:

1. Excise the function body and its single invocation from `bin/conduct` (keep the file valid bash).
2. Fix `CLAUDE.md:126` (the "HARNESS.md Flow" bullet) to stop claiming an auto-detect/auto-upgrade
   mechanism and instead point at the session-start hook.
3. Confirm `HARNESS.md` carries no stale reference (grep found none — verify, edit only if present).
4. Record a `CHANGELOG.md [Unreleased]` entry under **Removed** (CI enforces a non-empty
   `[Unreleased]`).
5. Run `test/test_harness_integrity.sh` — the mandatory pre-commit gate for this repo.

There is no `## Migration` block: consumers lose nothing actionable (the hook still surfaces the
missing reference), and no `settings.json` schema / hook wiring / skill symlink / `bin/conduct`
subcommand-or-flag surface changes — only an internal launch-time prompt is removed. `VERSION` stays
frozen at 0.99.19 (no bump until James declares 1.0).

Because this is a shell + docs change, TDD "tests" are grep/`bash -n`/integrity-suite assertions
rather than unit tests — appropriate for a Tier S harness-script removal.

## Prerequisites
- None. Work happens on branch `spec/drop-check-harness-config-consumer-claude-md-harne`.

## Tasks

### Task 1: Remove the check_harness_config function
**Story:** "Remove the check_harness_config function and its call site" — function-deletion happy path
**Type:** refactor

**Steps:**
1. Write failing check: `grep -c "^check_harness_config() {" bin/conduct` expects 0 (currently 1 → RED).
2. Verify RED.
3. Implement: delete the full `check_harness_config()` definition (formerly `bin/conduct:466-505`),
   including its closing brace and the trailing blank line, leaving the surrounding functions intact.
4. Verify GREEN: the grep now returns 0.
5. Commit: "refactor(conduct): remove check_harness_config function body".

**Files likely touched:**
- `bin/conduct` — delete the function definition.

**Dependencies:** none

### Task 2: Remove the call site
**Story:** same story — call-site happy path
**Type:** refactor

**Steps:**
1. Write failing check: `grep -c "^check_harness_config$" bin/conduct` expects 0 (currently 1 at line
   2897 → RED).
2. Verify RED.
3. Implement: delete the standalone `check_harness_config` invocation line (formerly `bin/conduct:2897`).
4. Verify GREEN: the grep returns 0.
5. Commit: "refactor(conduct): remove check_harness_config launch-time call".

**Files likely touched:**
- `bin/conduct` — delete the call line.

**Dependencies:** Task 1 (same file; sequence to keep diffs clean)

### Task 3: Assert valid syntax and no dangling references (negative path)
**Story:** "Remove the check_harness_config function and its call site" — negative path
**Type:** negative-path

**Steps:**
1. Write failing test: `bash -n bin/conduct` exits 0 AND
   `grep -rn "check_harness_config" . --exclude-dir=.docs --exclude-dir=.git` returns no matches.
2. Verify: after Tasks 1-2 this should pass; if any reference remains (bin/, hooks/, HARNESS.md,
   CLAUDE.md) it is RED — remove it.
3. Implement: remove any remaining stray reference surfaced by the grep.
4. Verify GREEN: grep clean, `bash -n` exits 0.
5. Commit: "test(conduct): assert no dangling check_harness_config references".

**Files likely touched:**
- `bin/conduct` and any file the grep flags.

**Dependencies:** Task 1, Task 2

### Task 4: Reconcile documentation
**Story:** "Reconcile documentation to remove the auto-upgrade claim" — happy + negative paths
**Type:** refactor

**Steps:**
1. Write failing check: `grep -c "check_harness_config" CLAUDE.md` expects 0 (currently 1 at line
   126 → RED).
2. Verify RED.
3. Implement:
   - Rewrite the `CLAUDE.md` "HARNESS.md Flow" bullet (line 126) so it no longer claims
     `check_harness_config` auto-detects/auto-commits; instead state that
     `hooks/claude/session-start-context.sh` detects a consumer CLAUDE.md missing the HARNESS.md
     reference and prints the block to add manually.
   - `grep -n "auto-upgrade\|check_harness_config" HARNESS.md` — if any hit, edit it the same way;
     grep currently shows none, so expect no edit.
4. Verify GREEN: `grep -c "check_harness_config" CLAUDE.md` returns 0; HARNESS.md clean.
5. Commit: "docs: point HARNESS.md-flow detection at the session-start hook".

**Files likely touched:**
- `CLAUDE.md` — rewrite the HARNESS.md Flow bullet.
- `HARNESS.md` — only if a stale reference exists.

**Dependencies:** none (independent of Tasks 1-3, but land together)

### Task 5: Changelog + integrity gate
**Story:** "Reconcile documentation" — integrity negative path
**Type:** infrastructure

**Steps:**
1. Add a `CHANGELOG.md` entry under `## [Unreleased]` → `### Removed`:
   "Removed `check_harness_config` (consumer CLAUDE.md → HARNESS.md auto-upgrade) from `bin/conduct`;
   detection is retained by the session-start context hook. Unblocks the v1.0 bin/conduct removal
   (#226)."
2. Run `bash test/test_harness_integrity.sh` — must pass (bash syntax, references, model table, etc.).
3. If it fails, fix the flagged issue (do not commit with known failures).
4. Verify GREEN: integrity suite exits 0.
5. Commit: "chore: changelog + integrity for check_harness_config removal".

**Files likely touched:**
- `CHANGELOG.md` — add the Removed entry.

**Dependencies:** Tasks 1-4 (changelog describes the completed removal; integrity runs over the final tree)

## Task Dependency Graph
```
Task 1 ─▶ Task 2 ─▶ Task 3 ─┐
Task 4 ─────────────────────┼─▶ Task 5
```

## Integration Points
- After Task 3: `bin/conduct` is fully purged of the function and passes `bash -n`.
- After Task 5: the whole change passes `test/test_harness_integrity.sh` and is release-clean.

## Verification
- [ ] All happy path criteria covered (Tasks 1, 2, 4)
- [ ] All negative path criteria covered (Task 3: no dangling refs / valid syntax; Task 5: integrity suite)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
