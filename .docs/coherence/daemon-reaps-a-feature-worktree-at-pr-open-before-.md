# Coherence: Deferred Feature-Worktree Reap (#1091)

**Date:** 2026-07-29 · **Track:** technical (no PRD — the `fr` row class is omitted) · **Tier:** M

Sources cross-checked for every verdict below:
`.docs/stories/daemon-reaps-a-feature-worktree-at-pr-open-before-.md` (S1-S6),
`.docs/plans/daemon-reaps-a-feature-worktree-at-pr-open-before-.md` (tasks 1-19),
and, in prose below, the six Desired-outcome bullets of `jstoup111/ai-conductor#1091`.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-S1 | task-4, task-5, task-6 | covered | Reap removed from the runner (4), retained-artifact guarantee pinned (5), negative paths for halt outcomes, cleanup throw, and absent worktree (6). |
| story | story-S2 | task-1, task-2, task-3, task-8, task-9, task-10 | covered | Probe present/absent/indeterminate (1-3), reap on a proven record (8), retain-and-recheck (9), idempotence and teardown-failure isolation (10). |
| story | story-S3 | task-7, task-11 | covered | Terminal-state branch split so CLOSED and NOTFOUND prune without teardown (7); UNKNOWN skip and closed-after-merge precedence (11). |
| story | story-S4 | task-12, task-13 | covered | Five reason tokens plus the failed-reap wording (12); repeat-pass suppression with changes still logged (13). |
| story | story-S5 | task-14, task-17, task-18, task-19 | covered | Disk-enumerated dashboard category including the registry-capped slug (14); reclaim verb (17); all rejection cases (18); `bin/conduct` forwarding confirmed (19). |
| story | story-S6 | task-15, task-16 | covered | Rebase-resolution skip made observable (15); CI-fix coexistence and `resolve-` disjointness pinned (16). |
| task | task-1 | story-S2 | covered | Probe returns present for a squash-merged feature, where ancestry returns false. |
| task | task-2 | story-S2 | covered | Probe returns absent without throwing. |
| task | task-3 | story-S2 | covered | Probe fails closed to indeterminate on fetch or git failure. |
| task | task-4 | story-S1 | covered | Runner no longer calls `teardownWorktree` on a verified ship. |
| task | task-5 | story-S1 | covered | Retained evidence artifacts pinned by test. |
| task | task-6 | story-S1 | covered | Halt outcome, cleanup throw, and absent worktree cases. |
| task | task-7 | story-S3 | covered | Infrastructure-typed; serves S3's three-way disposition and is the seam tasks 8-11 build on. |
| task | task-8 | story-S2 | covered | Merged plus record-present reaps and prunes in one pass. |
| task | task-9 | story-S2 | covered | Record absent or indeterminate retains and re-checks. |
| task | task-10 | story-S2 | covered | Reap is idempotent; teardown failure is isolated per entry. |
| task | task-11 | story-S3 | covered | UNKNOWN skip; a proven-on-main record outranks a closed-state read. |
| task | task-12 | story-S4 | covered | Reason tokens for every disposition. |
| task | task-13 | story-S4 | covered | Repeat-pass log suppression, changes still logged. |
| task | task-14 | story-S5 | covered | Dashboard category enumerated from disk, not the watch registry. |
| task | task-15 | story-S6 | covered | Rebase-resolution skip reason names retention. |
| task | task-16 | story-S6 | covered | CI-fix coexistence with a retained feature worktree. |
| task | task-17 | story-S5 | covered | Reclaim verb happy path, including root resolution from any cwd. |
| task | task-18 | story-S5 | covered | Reclaim rejects in-flight runs, globs, paths, lists, and unknown slugs. |
| task | task-19 | story-S5 | covered | Verify-only; confirms `bin/conduct` already forwards the bare `daemon` token. |

## Plan Coverage-Table Cross-Check

The plan's own Coverage Mapping table was cross-checked row by row against the parsed task tree.
Every task id it cites (1-19) exists as a `### Task N:` heading in the same file, and no cited id is
phantom. No `claim-<row>` gap.

## Issue Outcome Coverage (prose — the `outcome` row class is omitted)

No intake outcome bullets are staged or committed for this stem at gate time, so the `outcome` row
class is omitted rather than authored (an empty outcome layer is "not required," never a gap). The
six Desired-outcome bullets of `jstoup111/ai-conductor#1091` were nonetheless mapped by hand against
the story text, and the result is recorded here so the shortfall is not lost:

- **Outcome 1** (evidence exists between PR-open and record-on-main) — covered by S1, S2.
- **Outcome 2** (closed-unmerged resume: no `no_task_progress`, no re-execution) — covered by S3.
- **Outcome 3** (cleanup without operator action once on main) — covered by S2, S5.
- **Outcome 4** (per-feature retained/reaped log line naming the condition) — covered by S4.
- **Outcome 5** (retained worktree never blocks post-ship remediation) — **partially covered.** The
  bullet requires both CI-fix and rebase-resolution to still succeed. S6 covers the CI-fix half and
  requires the rebase-resolution half to be *observably skipped*, not to succeed: Gate 6 of
  `isEligibleForResolve` (`autoresolve.ts:216-226`), implementing rule 3 of APPROVED
  `adr-2026-07-04-resolution-worktree-lifecycle`, suppresses rebase-resolution for every retained
  slug. The operator was presented with retire-the-gate / replace-with-liveness-check / descope
  options on 2026-07-29 and chose descope; the repair is **#1150**, milestone v1.1. Because #1091 is
  v1.0, v1.0 ships with automatic rebase-resolution suppressed and conflicted open PRs resolved by
  hand. Recorded in the ADR's Consequences, as Condition 1 of the architecture review, as Conflict 3
  of the conflict report, and in the stories file header.
- **Outcome 6** (abandoned closed-unmerged feature is visible and reclaimable) — covered by S3, S5.

## Summary

- story — 6 covered, 0 gaps
- task — 19 covered, 0 gaps
- outcome — row class omitted; no staged intake bullets at gate time (prose mapping above)
- fr — row class omitted; technical track, no PRD

Every `covered` verdict above was confirmed by reading the cited counterpart text in its own artifact
file; none was inferred from a name match. The one substantive shortfall (outcome 5) is a deliberate,
operator-approved descope, not an authoring omission.
