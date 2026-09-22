# Halt record

Status: halted
Slug: rebase-reopens-completed-repair-tasks-against-stal
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-rebase-reopens-completed-repair-tasks-against-stal
Head SHA: fe3c4b513155964d48dd30ca4f23226f3c265329
Halted at: 2026-09-22T13:30:31.000Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the criterion.

Criterion: Story 2 happy: Given an open obligation whose `baseline.head` is a residue commit (no patch-id match) and at least one later pre-image commit in `onto..origHead` is a rewrite-map key, when translation runs, then `baseline.head` equals the post-image of the earliest such later commit in first-parent order.
Task ids: 2
Done when checks: `selectRepairBoundaryTranslation` returns `successor` with the post-image of the earliest first-parent commit strictly after the boundary, as asserted by the squashed-boundary fixture in rebase-translate.test.ts. | The same function returns `unchanged` when every map key lies at or before the boundary, when the candidate's mapped sha is not reachable, and when the boundary is outside the pre-image list, each asserted by its own fixture. | A merge-commit fixture asserts the candidate list comes from `rev-list --first-parent` so a commit reachable only via a second parent is never selected. | A property assertion on every successor fixture shows the chosen pre-image index is strictly greater than the boundary index, so `newHead..HEAD` is a subset of `oldHead..HEAD`. | A residue-boundary fixture where every map key lies at or before the boundary asserts `baseline.head` is unchanged and that a following task-progress evaluation returns the existing `repair boundary <sha> is not an ancestor of HEAD` reason.
Missing assertion: The cited checks assert successor selection but do not explicitly assert that translation assigns that successor to baseline.head.
```
