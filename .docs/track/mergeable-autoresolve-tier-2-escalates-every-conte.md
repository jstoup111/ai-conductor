# Track: Mergeable autoresolve tier-2 escalates every content conflict to the operator

Track: technical

Scope boundary: balanced — sweep-dispatched tier-2 resolution decides supersession under engine verification only when every conflicted path is test code (operator narrowed 2026-09-20 after the ADR sweep; conflicts touching any non-test path escalate as today), records its verdict on the PR, and the mergeable sweep clears a stale `needs-remediation` label once the PR is no longer conflicting and the recorded escalation cause is conflict resolution. Excluded: the finish-time rebase (keeps today's strict Ambiguity Gate) and the merge-commit rebase-strategy hypothesis in #2589.

Daemon-internal conflict-resolution behavior with no user-facing product requirements; acceptance criteria live in stories.
