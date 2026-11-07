# Track: Rebase base-refresh revalidation halts needs-human at child BUILD entry

Track: technical

Scope boundary: Balanced. Covers both trigger paths that reach child BUILD entry with a queued
revalidation and no repair marker: the in-loop `rebase` restack (#3477) and the routed-exit
fall-through (#3473, folded into #3477). Excluded: reworking or removing the `revalidating` cursor
source, and changing when restacks enqueue children.

Approach: one shared reconcile→consume admission helper, used by resume preflight, routed exit, and
BUILD-region entry. When the cursor resolves `revalidating` with no matching marker, region entry
admits the queue head and re-resolves before entering. A halt happens only on genuine
unavailability, and its reason names the queued child, the open rounds, and the marker owner.
Rejected: consuming only after the `rebase` step (a third copy of the logic that misses the
routed-exit path), and admitting at enqueue time (conflicts with the #3445 round-admission fence and
multi-generation queue merging).

Internal engine routing defect with no user-facing product requirements; acceptance criteria live in
stories. Operator confirmed track, scope, and approach on 2026-10-29 and reconfirmed them for reuse
on 2026-10-31 after blockers #3445 (PR #3521) and #3455 (PR #3543) shipped.
Source: intake jstoup111/ai-conductor#3477.
