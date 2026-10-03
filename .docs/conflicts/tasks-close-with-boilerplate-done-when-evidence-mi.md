# Conflict Check: tasks-close-with-boilerplate-done-when-evidence-mi

**Date:** 2026-10-02
**Stories checked:** `.docs/stories/tasks-close-with-boilerplate-done-when-evidence-mi.md` (Stories 1-7) against every story in `.docs/stories/`
**ADR corpus:** `repo_wide` (per `conflict_check.adr_corpus`). The architecture review swept every approved ADR; the only governing ADR changed is `adr-2026-08-22-done-when-evidence-at-task-close`, amended additively with D5-D9 and compared against all seven stories with no conflict. Narrowed out: ADRs with no subject overlap with task close, BUILD completion, plan Done-when shape, remediation append, or `prd_audit` input.
**Result:** PASS — 0 blocking, 3 degrading (resolved in this spec's stories), 1 sequencing dependency.

## Conflict: Stamp-resolved tasks and the unverified set

**Stories involved:** No-diff task evidence stamp Story 1 vs Story 5
**Files:** `.docs/stories/no-diff-task-evidence-stamp.md` vs `.docs/stories/tasks-close-with-boilerplate-done-when-evidence-mi.md`
**Type:** state-conflict
**Severity:** degrading

**Description:** The existing story requires the completion predicate to return done when the only otherwise-unresolved task is resolved by a skipped stamp. If a stamp-resolved task with a `[test]` check counted as unverified, the first predicate call would nudge instead of completing.

**Resolution Options:**
1. Count only checks with an explicit `unverified` task-close record as unverified, so stamp-resolved tasks keep their existing path.
2. Count stamp-resolved tagged checks as unverified and narrow the existing story to "after the nudge".

**Recommendation and resolution:** Option 1, applied. Story 5 now states that only explicit `unverified` close records count and adds a negative criterion for stamp-resolved tasks; Story 4's verify-only refusal is scoped to `conduct task done`.

## Conflict: Any evidence closes every declared check

**Stories involved:** Record task done completion without a current task Story 1 vs Story 2
**Files:** `.docs/stories/record-task-done-completion-without-a-current-task.md` vs `.docs/stories/tasks-close-with-boilerplate-done-when-evidence-mi.md`
**Type:** contradiction
**Severity:** degrading

**Description:** The existing criterion records "evidence for every declared check" without qualification; Story 2 refuses free-text evidence on a tagged check. The existing story's plans predate tags, so it is the untagged case.

**Resolution Options:**
1. State in Story 2 that it narrows the existing rule for tagged checks only, leaving the existing story true for every untagged check.
2. Rewrite the existing story in a companion PR.

**Recommendation and resolution:** Option 1, applied. Story 3 already keeps untagged checks unchanged, and the existing plan-gap criterion still holds for untagged checks. A foreign-stem story edit is avoided because land rejects it.

## Conflict: A fully resolved build completes

**Stories involved:** Build step completes with every plan task still pending, Story 3 vs Story 5
**Files:** `.docs/stories/build-step-completes-with-every-plan-task-still-pe.md` (merged by PR #2916) vs `.docs/stories/tasks-close-with-boilerplate-done-when-evidence-mi.md`
**Type:** overlap
**Severity:** degrading

**Description:** #2014's Story 3 completes BUILD whenever every task is resolved; Story 5 withholds completion once when explicit unverified records exist. Both edit `CUSTOM_COMPLETION_PREDICATES.build`. #2014's Story 2 also requires the pending-task reason to list every pending task.

**Resolution Options:**
1. Withhold only when explicit unverified records exist and every task is resolved; keep the pending-task reason first and unchanged; build after #2014.
2. Merge both changes into one predicate change.

**Recommendation and resolution:** Option 1, applied. Story 5 already requires a build with no unverified records to complete with no nudge and the pending-task reason to stay unhidden; the plan orders this work after #2014's build.

## Sequencing: prd_audit input projection

`prd-audit-receives-bounded-inputs-and-returns-vali` (#2890, still building) replaces `prd_audit`'s inputs with an engine-owned versioned projection. Story 6 adds one field to it, which is additive to that spec's Story 1 and expected under its projection-version freshness rule. Not a conflict; the plan builds Story 6 after #2890 ships.

## Examined and compatible

`verify-only-prove-closed-task-evidence.md`, `build-stall-remediation-skips-no-task-progress.md`, `land-time-validation-that-every-plan-task-carries-.md`, `a-coverage-claim-can-name-a-task-whose-done-when-d.md`, `emit-a-valid-done-when-block-on-engine-appended-re.md` (tagged remediation checks keep the 2-5 shape), `prd-audit-kickback-preserves-task-status.md`, `builds-stall-when-work-lands-without-task-trailer-.md`, `demote-task-stamping-to-telemetry.md`, `noevidenceattempts-persists-across-unpark-so-re-di.md`, `kickback-cap-raise-replays-the-halted-lap-s-remedi.md`, `tautology-fails-are-unfixable-when-planned-behavio.md`, `build-review-re-judges-what-the-plan-architecture-.md`, `as-built-review-receives-bounded-inputs-and-return.md`, `prd-audit-receives-bounded-inputs-and-returns-vali.md`.
