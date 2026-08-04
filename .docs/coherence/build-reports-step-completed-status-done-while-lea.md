# Coherence Mapping: Uncommitted-work floor under BUILD completion (#1270)

**Status:** Accepted
**Date:** 2026-08-03
**Tier:** M
**Track:** Technical
**Plan stem:** `build-reports-step-completed-status-done-while-lea`
**PRD:** none — technical track. Acceptance criteria live in the stories; the `fr` row class is
therefore not required and is omitted rather than represented by placeholders.
**Stories:** `.docs/stories/build-reports-step-completed-status-done-while-lea.md`
**Plan:** `.docs/plans/build-reports-step-completed-status-done-while-lea.md`
**ADR:** `.docs/decisions/adr-2026-08-03-uncommitted-work-floor-under-build-completion.md` (APPROVED)

The four `outcome-<n>` ids below correspond, in order, to the four staged intake Desired-outcome
bullets carried from jstoup111/ai-conductor#1270.

## Traceability

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-S2, story-S3, story-S6 | covered | "A BUILD step cannot report `status:done` while its worktree has uncommitted changes…" — S2 closes the completion-gate path, S3 closes the budget-exhaustion escape (the second, gate-bypassing door), S6 pins the fail direction shared by both. All three are required: S2 alone leaves the escape open. |
| outcome | outcome-2 | story-S2, story-S3, story-S5 | covered | "…the recorded reason names the uncommitted paths…" — S2 puts the paths in the predicate reason (which reaches the operator verbatim via `step_failed.error`), S3 puts them in the HALT reason at exhaustion, S5 puts them in the retry hint that steers the next dispatch. |
| outcome | outcome-3 | story-S8 | partial | "Verification evidence records the SHA it actually ran against, and a gate blocked by a prerequisite whose evidence predates the current working state is distinguishable from one blocked by a genuine failure." **First clause: already true and made honest.** `provenanceHeadSha` is already recorded at fingerprint time and has zero readers; S8 adds the cleanliness flag so the SHA cannot be misread as describing the tested content. **Second clause: NOT delivered here** — it is #1249's mechanism (group-membership retention in `resolveGroupMembership`), explicitly fenced by ADR Decision 8. Recorded as `partial` deliberately rather than claimed as covered. |
| outcome | outcome-4 | story-S4 | covered | "A BUILD session that legitimately produces no changes still completes normally — an empty diff is not a dirty worktree." S4 pins clean-tree, prior-attempt-resolved, and gitignored-residue cases, plus the false-positive guard on ignored untracked files. |
| story | story-S1 | task-1, task-2 | covered | Probe type + fail-direction helper (task-1), injection in `completionCtx` (task-2). |
| story | story-S2 | task-3, task-4 | covered | Predicate conjunct and reason format (task-3), check-ordering pinned against halt-marker/plan/task-resolution precedence (task-4). |
| story | story-S3 | task-6, task-7, task-8 | covered | Escape guard (task-6), regression proof of the exact bypass shape with a RED-against-pre-fix step (task-7), HALT reason naming the paths (task-8). |
| story | story-S4 | task-10 | covered | No-op build and gitignored-residue parity pins. |
| story | story-S5 | task-9 | covered | `buildRetryHint` `uncommitted` branch, with byte-for-byte preservation of every other hint. |
| story | story-S6 | task-5 | covered | Fail-open-on-absence / fail-closed-on-dirt pinned; both enforcement sites share one helper (delivered in task-1) so the direction cannot drift. |
| story | story-S7 | task-11, task-13 | covered | Post-rebase closure behavior pinned by test (task-11); the chosen behavior recorded in `docs/reference/steps.md` (task-11 step 4 and task-13). |
| story | story-S8 | task-12 | covered | Additive optional evidence field, validators accepting absence, and an assertion that the `test_suite` verdict is unchanged. |
| task | task-1 | story-S1 | covered | — |
| task | task-2 | story-S1 | covered | — |
| task | task-3 | story-S2 | covered | — |
| task | task-4 | story-S2 | covered | — |
| task | task-5 | story-S6 | covered | — |
| task | task-6 | story-S3 | covered | — |
| task | task-7 | story-S3 | covered | — |
| task | task-8 | story-S3 | covered | — |
| task | task-9 | story-S5 | covered | — |
| task | task-10 | story-S4 | covered | — |
| task | task-11 | story-S7 | covered | — |
| task | task-12 | story-S8 | covered | — |
| task | task-13 | story-S7 | covered | Documentation and contract sync, including the `skills/pipeline/SKILL.md` prompt-rule rewrite the deterministic-enforcement principle requires. |

## Coverage notes

- **No orphan tasks.** Every one of the 13 plan tasks cites exactly one real story id on its
  `**Story:**` line (one id per line, never a comma list).
- **Every story is covered** by at least one task; the plan's `## Coverage Check (story → task)`
  table reconciles row-for-row with the task tree above.
- **One deliberate `partial`.** `outcome-3` is the only non-`covered` row. Its second clause belongs
  to #1249 and is fenced in the ADR, the conflict-check, and the plan's Out-of-scope section. It is
  recorded as partial so that neither this spec nor #1249 can later be closed on the other's
  evidence.
