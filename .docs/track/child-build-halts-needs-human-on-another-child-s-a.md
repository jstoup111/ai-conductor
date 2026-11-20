# Track: Child BUILD halts needs-human on another child's already-resolved build-review case

Track: technical

Scope boundary: comprehensive — all four outcomes of intake jstoup111/ai-conductor#3658, with
autonomous recovery as the requirement. A BUILD for child N never has settled or foreign
remediation state on its live path; a stall or halt that cites only settled or foreign remediation
state is discarded and re-dispatched under a bounded cap; only cap exhaustion stops the feature,
as a mechanical halt the existing halt-clear path already clears. No new operator command is in
scope. An open, owned case still reaches its child's BUILD unchanged.

Engine-internal remediation state ownership and halt routing; no product requirements, so
acceptance criteria live in stories. Selected approach: live remediation state is owned and open
by construction (per-child artifacts, retired from the live path when their cases settle, plus
engine-side validation of a cited case at the stall seam). Rejected: reader-side filtering alone
(leaves stale files readable, relying on prompt discipline) and stall-side validation alone (every
affected BUILD still spends a session on the stale file before recovery).
