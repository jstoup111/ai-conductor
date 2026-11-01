# Conflict Check: A routed fix refreshes a published stack (#3269)

**Date:** 2026-11-01
**New stories:** `.docs/stories/a-published-stacked-child-changes-silently-when-a-.md` (Stories 1-10)

**Method:** every pair sharing a behaviour, entity or gate was tested in both directions, story against story and APPROVED ADR against story. Candidate stories were found by searching all 667 story files for published-stack, publication record, tip-guard, `finish-choice`, processed-slug and re-dispatch language, then reading each hit.

**ADR corpus:** repo-wide (374 ADRs), narrowed by subject.
- **Examined:** `adr-2026-10-17-stacked-feature-publication-as-native-stack`, `adr-2026-10-12-routed-whole-feature-repair`, `adr-2026-10-24-operator-route-round-for-closed-stacked-children`, `adr-2026-10-10-stacked-restack-journaled-replay`, `adr-2026-10-07-per-child-build-region`, `adr-2026-09-11-finish-mergeability-respects-active-review-inputs`, `adr-2026-10-09-shipped-pr-readiness-verdict`, `adr-2026-08-23-committed-halt-record`, `adr-2026-07-28-total-halt-classification-legacy-boundary`, `adr-2026-07-07-ship-ci-feedback-loop`, `adr-2026-07-03-post-rebase-force-with-lease`.
- **Narrowed out:** every other ADR, because none names a published stack, the tip guard, or remote Git publication.

**Result:** 1 blocking conflict and 4 contradictions with shipped stories, all resolved. No degrading conflict remains.

## Conflict: Re-pending `rebase` halts every refresh

**Stories involved:** Story 4 vs the `rebase` stale-verdict story
**Files:** `.docs/stories/a-published-stacked-child-changes-silently-when-a-.md` vs `.docs/stories/done-step-with-an-unsatisfied-gate-verdict-loops-s.md`
**Type:** oscillating
**Severity:** blocking

**Description:** Leaf return re-pends every post-build gate, including `rebase`, with an unsatisfied verdict. On a published stack the `rebase` step refuses, completes successfully, and writes no verdict. The shipped story then halts `needs-human` after one dispatch, so a reopened run could never reach FINISH.

**Resolution:** Operator approved 2026-11-01: on a published stack, leaf return leaves `rebase` and its verdict untouched. Added to `adr-2026-11-01-routed-fix-refreshes-a-published-stack` decision 4, the diagram, and Story 4.

## Conflict: Shipped stories still refuse routing on a published stack

**Stories involved:** Story 1, Story 2 and Story 3 vs four shipped criteria
**Files:** `.docs/stories/stacked-features-cannot-be-published-reviewed-and-.md`, `.docs/stories/a-routed-fix-is-never-carried-up-the-stack-or-foll.md`, `.docs/stories/manual-reviewer-edits-cannot-be-landed-safely-in-t.md`
**Type:** contradiction
**Severity:** blocking

**Description:** Those stories state that route admission, the routed exit, `stack land`, and any engine rewrite of a published member all refuse on any active publication record. The new design allows each one under named conditions.

**Resolution:** This is the deliberate change the operator approved. The superseded assertions were replaced in place in those files, narrowing each refusal to a mismatched or unauthorized case. The rest of each story is unchanged.

## Pairs checked with no conflict

- **Merged-PR guard (`2026-07-09-daemon-merged-pr-guard-on-retry.md`):** "the slug is never re-dispatched" covers a merged PR's clean stop. Reopening requires an active publication record and an open round or pending ledger, which a merged PR's teardown removes.
- **False-ship guard (`daemon-false-ship-guard.md`):** the reopen sweep removes `finish-choice` and DONE, and the re-pended FINISH writes them again, so the guard reads fresh markers.
- **Halt-record push (`adr-2026-08-23-committed-halt-record` and Story 10 of the publication stories):** a rewritten leaf still skips the push with `stack-tip-mismatch`, as Story 3 requires.
- **Base refresh, re-kick, ci-fix and autoresolve:** unchanged, matching their shipped stories.
- **Stack verification (`stacked-features-cannot-be-published-reviewed-and-.md`):** a head differing from its receipt still halts. A refresh advances the receipt with each push, so a refreshed member matches.
- **Story 5 vs Story 8:** comments follow every push, and a comment failure re-pushes nothing.
