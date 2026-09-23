# Conflict Check: Park stops retries inside an already-dispatched step

**Date:** 2026-09-22
**Stories:** `.docs/stories/daemon-park-does-not-stop-retries-inside-an-alread.md` (Stories 1–13)
**ADR corpus:** `repo_wide`
**Result:** PASSED after resolution. Five blocking conflicts were resolved by operator choice, none
remain, and no degrading conflicts were accepted.

## ADR corpus

The architecture review for this feature swept all 317 APPROVED, non-superseded ADRs in
`.docs/decisions/` at the Decision-section level. It excluded 281 files that are fully superseded
or not ADRs. Twelve ADRs were examined in full, and their stories-relevant decisions were compared
here:

- adr-2026-07-29-operator-park-scheduling-unit-boundary: D4 and D10 conflicted with the design.
  Already resolved by amendment D11–D14 before stories were written. Stories 1–13 match the
  amended decisions.
- adr-2026-07-13-park-all-dispatch-paths D2, adr-2026-07-04-operator-park-marker D3,
  adr-2026-07-30-provider-preparation-lifecycle-supervision D2/D5,
  adr-2026-07-12-progress-aware-build-halt D1, adr-2026-07-05-retry-as-escalation-ladder D1/D2,
  adr-2026-07-10-validation-group-join D2, adr-2026-07-13-retry-classify-rerun-vs-route D4,
  adr-2026-08-11-halt-events-ride-the-persisted-spine D1,
  adr-2026-07-04-event-driven-halt-clear-wake D3,
  adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever: each was compared against the
  stories whose behavior it addresses, in both directions. No story contradicts any of them.
  Story 4 honors the progress and escalation decisions, Story 7 honors the join decision, and
  Stories 9–11 honor the no-process-inspection decision.
- All other ADRs were narrowed out: their decisions do not address park, retry, dispatch, group
  join, or the park command's output.

## Story-corpus scan

The feature's stories were compared against every existing story file that mentions park, group
join, retry accounting, or daemon lifecycle. That includes park-all-dispatch-paths,
noevidenceattempts-persists-across-unpark-so-re-di, let-an-operator-park-settle-without-a-needs-human-,
2026-07-04-daemon-lifecycle-controls, retry-as-escalation, and
park-in-flight-features-at-step-boundaries-after-p. Only the last one conflicts.

## Conflict 1: A running step reaches its unparked terminal outcome

**Stories involved:** park-in-flight Story 1 vs Story 4 (A declined attempt costs nothing)
**Files:** `.docs/stories/park-in-flight-features-at-step-boundaries-after-p.md` vs this feature's stories
**Type:** contradiction
**Severity:** blocking

**Description:** The old story says a parked running step "reaches the same natural terminal outcome
it would have reached without the park". Without the park, that outcome includes its retries. Story
4 leaves the step `in_progress` once its next attempt is declined. If one story holds fully, the
other fails.

**Resolution Options:**
1. Rewrite old Story 1 so that the running attempt settles uncancelled and no further attempt
   starts.
2. Narrow Story 4 to self-host only. That contradicts FR-6.

**Recommendation and decision:** Option 1, chosen by the operator.

## Conflict 2: Every started member runs to its natural terminal outcome

**Stories involved:** park-in-flight Story 2 vs Story 7 (A parked parallel-group member settles as parked)
**Type:** contradiction
**Severity:** blocking

**Description:** Old Story 2 lets each started member continue to its natural terminal outcome,
retries included. Story 7 declines a member's retry and settles it as parked.

**Resolution:** Rewrite old Story 2 so that running attempts settle and no member starts a further
attempt. Chosen by the operator.

## Conflict 3: Group statuses are limited to the normal join rules

**Stories involved:** park-in-flight Story 3 vs Story 7
**Type:** state-conflict
**Severity:** blocking

**Description:** Old Story 3's mixed-join criterion lists only successful, failed, and skipped
member outcomes. Story 7 adds a parked member outcome.

**Resolution:** Extend the old criterion with the parked outcome. Chosen by the operator.

## Conflict 4: A late park applies only at the next boundary

**Stories involved:** park-in-flight Story 7 vs Story 6 (Park races fail safely)
**Type:** contradiction
**Severity:** blocking

**Description:** The old negative path applies a park that appears after a unit starts "only at the
next boundary". Story 6 declines the unit's next attempt.

**Resolution:** Apply the park at the next attempt or the next boundary, whichever comes first.
Chosen by the operator.

## Conflict 5: No park-specific member behavior

**Stories involved:** park-in-flight Story 8 vs Story 7
**Type:** contradiction
**Severity:** blocking

**Description:** Old Story 8 grants future groups park behavior "without a park-specific exception
for its members". Story 7 adds per-member park handling.

**Resolution:** State that the per-attempt member behavior comes from the shared group core, with no
group-specific code. Chosen by the operator.

## Resolution delivery

The shipped feature's stories file has a different stem, so the spec-branch land gate rejects edits
to it. The five rewrites therefore ship as a companion main-based PR on branch
`docs/park-in-flight-stories-per-attempt-2103`, following the PR #1928 precedent, to merge
together with this spec PR. This feature's own stories needed no change.
