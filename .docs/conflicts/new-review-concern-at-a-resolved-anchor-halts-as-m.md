# Conflict Check: New review concern at a resolved anchor halts as malformed case state

**Date:** 2026-10-02
**Stories:** `.docs/stories/new-review-concern-at-a-resolved-anchor-halts-as-m.md` (Stories 1–7)
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml`). All 638 decision files were swept during
the architecture review. The examined, governing set was:
- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication, including D6 (and the
  partially superseded predecessor adr-2026-08-29-build-review-remediate-case-adjudication, retained)
- adr-2026-09-07-durable-prd-widening-decision-reconciliation
- adr-2026-09-10-portable-build-review-policy
- adr-2026-08-13-stable-build-review-finding-dispositions
- adr-2026-08-18-content-anchored-finding-reference-schema
- adr-2026-08-12-cumulative-build-review-convergence-bound
- adr-2026-08-11-halt-events-ride-the-persisted-spine

The rest were narrowed out because their subject does not overlap: kickback, park, PR publication,
intake labels, and similar.
**Result:** PASSED. Zero blocking conflicts. Two degrading gaps were resolved in the new stories.

## Stories examined

Read closely:
- `refuted-build-review-finding-cycles-to-a-needs-hum.md`
- `build-review-rubrics-need-a-post-join-adjudicator-.md`
- `operator-configurable-confidence-floor-for-acting-.md`
- `projects-cannot-add-portable-non-competing-build-r.md`

Scanned and judged not relevant:
- `grade-the-diff-for-security-defects-before-ship-vi.md`
- `grade-diffs-for-event-spine-bypasses-in-build-revi.md`
- `stop-refuting-blanket-environment-denial-claims-th.md`
- `build-review-rubric-dispositions-and-fan-out.md`
- `kickback-cap-raise-replays-the-halted-lap-s-remedi.md`
- `equivalent-re-worded-findings-escape-their-accepte.md`
- `clean-rubric-judgements-rejected-as-invalid-provid.md`
- `remediation-halts-when-the-owning-plan-task-is-alr.md`
- `an-unrecognized-remediation-disposition-is-dropped.md`

Every pair sharing a behavior was tested in both directions.

## Conflict: Findings JSON mode could omit the declared lineage

**Stories involved:** Story 7 (new) vs refuted-build-review-finding-cycles Story 6
**Type:** overlap
**Severity:** degrading
**Description:** The existing story requires JSON output to carry the same case fields as the
human rendering. New Story 7 originally specified only the human line.
**Resolution:** Story 7 now carries JSON-mode happy and negative criteria and tests both modes.

## Conflict: A declared distinct case later resolved by refutation was unpinned

**Stories involved:** Story 5 (new) vs refuted-build-review-finding-cycles Story 4
**Type:** overlap
**Severity:** degrading
**Description:** After a declared distinct case is refuted, S is linked by resolved R (`acted`) and a
refuted case. The refutation stories require S to be settled. No new criterion pinned that R's
live link must not re-halt S as a regression.
**Resolution:** Story 5 gained a negative path asserting that S is settled and that no regression
halt is written, and its Done When names the refuted-distinct-case transition. This is consistent
with D6.5 (resolved links contribute D5.1 finalization).

## Assumption resolved in stories

The typed reason for an unbound `refute` row carrying `distinctFrom` was unspecified. Story 3 now
gives the existing refute-without-binding reason precedence.

## Accepted

No degrading compromise remains open.
