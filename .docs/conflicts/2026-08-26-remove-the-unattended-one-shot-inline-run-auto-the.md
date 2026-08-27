# Conflict Report: remove the unattended one-shot inline run (--auto remnants)

**Date:** 2026-08-26 · **Corpus:** change_set ADRs + all `.docs/stories/` · **Result after resolution:** clean

Unrelated `--auto` string hits excluded as different surfaces: `bin/update --auto`,
`rtk init --auto-patch`, `git rebase --autostash`, legacy `bin/conduct` loop flags
(`bin-conduct-unknown-subcommand-guard.md` governs the bash wrapper, not `conduct-ts inline`).

## Conflict: retired inline example vs flow-examples stories — RESOLVED

**Stories involved:** New Story 3 (examples without the one-shot demo) vs `flow-examples.md` Stories 1 and 4
**Files:** .docs/stories/remove-the-unattended-one-shot-inline-run-auto-the.md vs .docs/stories/flow-examples.md
**Type:** contradiction · **Severity:** blocking (resolved)

Old Story 1 asserted five scenarios including inline; old Story 4 asserted `inline.sh` runs
`conduct-ts inline … --auto` printing `PASS inline/<tier>`. Both are impossible once inline.sh is
deleted. **Resolution (operator-approved, option 1):** superseded assertions replaced in place —
scenario list is now four with the daemon as the unattended demo; Story 4 re-shaped to the daemon
flow. No amendment record per story-artifact rule.

## Conflict: --auto RunMode regression assertion vs rejection — RESOLVED

**Stories involved:** New Story 1 (rejection names daemon + guide) vs `runmode-interactive-flag.md`
**Files:** .docs/stories/remove-the-unattended-one-shot-inline-run-auto-the.md vs .docs/stories/runmode-interactive-flag.md
**Type:** contradiction · **Severity:** blocking (resolved)

Old story asserted `--auto` still resolves `RunMode 'auto'` "no regression" — falsified by shipped
#1509 and by this feature. **Resolution (operator-approved, option 1):** the two assertions replaced
in place with the rejection behavior; mutual-exclusion assertions retained unchanged.

## Checks

All six conflict types evaluated pairwise over stories sharing the run-mode/examples surfaces,
both directions; no oscillation (each conflict is one-directional supersession of a shipped-state
assertion). ADR-vs-story: the four branch-pinning ADRs are consistent with Story 4 (daemon
behavior preserved); the two ADR amendments made in architecture-review align the corpus. No
degrading conflicts accepted. Re-check after the in-place replacements: zero conflicts.
