# Complexity: Mergeable autoresolve tier-2 escalates every content conflict to the operator

Tier: M

Rationale: confined to one subsystem (the mergeable sweep's autoresolve path) but crosses
several seams within it — the shared `rebase` skill gains a sweep-only judgement mode, the
tier-2 resolver's result contract gains a schema-bound verdict with declared-superseded
commits, the `featureCommitsPreserved` acceptance guard must accept only declared drops, the
PR gains an audit comment, and sweep eligibility gains a stale-label clear. It amends the
APPROVED rebase-resolution ADRs rather than introducing new architecture, adds no config
schema or CLI surface, and the expected story count is single-digit. The finish-time rebase
is explicitly out of scope, which keeps it below Large.
