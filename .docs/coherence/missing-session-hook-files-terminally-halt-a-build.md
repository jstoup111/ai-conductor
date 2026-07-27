# Coherence Check: Repair missing session hooks instead of terminally halting the build (#896)

**Date:** 2026-07-27
**Tier:** M
**Track:** Technical (no PRD)
**Plan stem:** `missing-session-hook-files-terminally-halt-a-build`
**Result:** COVERED — zero gaps

No `fr` row class: this is a technical-track spec (`.docs/stories/missing-session-hook-files-terminally-halt-a-build.md`
states "Technical track (no PRD)" explicitly) — omission is correct, not a gap.

No `outcome` row class: `.docs/intake/missing-session-hook-files-terminally-halt-a-build.md` contains
only `Source-Ref: jstoup111/ai-conductor#896` and `Owner: jstoup111` — no staged Desired-outcome
bullets are present in the committed marker, so the outcome row class is not required.

No `claim` rows: the plan (`.docs/plans/missing-session-hook-files-terminally-halt-a-build.md`)
contains no `## Coverage Check` table.

## Stories

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-TI-1 | task-1, task-2 | covered | Task 1's `**Story:**` line cites "TI-1 (all criteria)"; Task 2's cites TI-1's "prepareWorktree routes through it" criterion. Story TI-1 exists in the stories file with matching acceptance criteria. |
| story | story-TI-2 | task-3, task-5 | covered | Task 3's `**Story:**` line cites "TI-2 (all criteria)"; Task 5's cites "TI-2 negative paths". Story TI-2 exists with matching happy/negative-path criteria. |
| story | story-TI-3 | task-4 | covered | Task 4's `**Story:**` line cites "TI-3 (all criteria)". Story TI-3 exists with the arming-invariant criteria Task 4 implements (re-stat vs. repair's return value). |
| story | story-TI-4 | task-6 | covered | Task 6's `**Story:**` line cites "TI-4 (all criteria)". Story TI-4 exists with matching wiring-repair criteria. |
| story | story-TI-5 | task-7 | covered | Task 7's `**Story:**` line cites "TI-5 (all criteria)". Story TI-5 exists with matching docs/CHANGELOG criteria. |

## Tasks

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-1 | story-TI-1 | covered | "`ensureSessionHooks` — exported, idempotent, outcome-reporting" implements TI-1's primitive requirement; `**Story:** TI-1 (all criteria)`. |
| task | task-2 | story-TI-1 | covered | "`prepareWorktree` routes through the primitive with unchanged posture" implements TI-1's `prepareWorktree` acceptance criterion; `**Story:** TI-1`. |
| task | task-3 | story-TI-2 | covered | "Guard repairs missing hooks, then re-stats, then proceeds" implements TI-2's happy-path repair-then-recheck; `**Story:** TI-2 (all criteria)`. |
| task | task-4 | story-TI-3 | covered | "Pin the arming invariant — re-stat, never the repair's word" implements TI-3's marker-arming criteria; `**Story:** TI-3 (all criteria)`. |
| task | task-5 | story-TI-2 | covered | "Branch-isolation regressions + supersede the stale HALT assertion" implements TI-2's negative-path/branch-isolation criteria; `**Story:** TI-2 negative paths`. |
| task | task-6 | story-TI-4 | covered | "Repair the settings wiring alongside the scripts" implements TI-4's wiring-repair criteria; `**Story:** TI-4 (all criteria)`. |
| task | task-7 | story-TI-5 | covered | "Docs, CHANGELOG, integrity suite, release-gate posture" implements TI-5's documentation/CHANGELOG/waiver criteria; `**Story:** TI-5 (all criteria)`. |

## Verdict

All five stories (TI-1 through TI-5) map to real plan tasks with explicit `**Story:**` line
citations, and all seven parsed tasks cite a real story id that exists in the stories file. No
phantom story or task identifier was found. The `fr` and `outcome` row classes are correctly
omitted (technical track, no staged intake outcomes). No `## Coverage Check` table exists in the
plan, so no `claim` rows apply. The coherence gate passes with zero gaps.
