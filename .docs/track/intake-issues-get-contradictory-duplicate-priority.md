# Track: intake-issues-get-contradictory-duplicate-priority

Track: technical

Internal automation-correctness fix with a one-time data cleanup: two independent writers
(`bin/intake-file` and the `intake-label-sync` workflow) both stamp `priority:`/`size:`
labels onto the same issue using an **additive** apply, with no notion of which writer's
value is authoritative. The result is contradictory duplicate labels on 23 of 109 open
issues. No product surface, no user-facing feature — the deliverable is a label-authority
contract in the shared `syncIssueLabels` seam plus a de-duplicating sweep.

Source: jstoup111/ai-conductor#889.
