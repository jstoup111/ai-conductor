# Track: Backend-neutral priority/size/dependency reads for daemon backlog ordering

Track: technical

Scope boundary: Introduce a backend-neutral ordering port (normalized priority band, size, and
blockers per work ref, selected by the project's tracker selection) and route every ordering read
through it — daemon backlog priority, blocker resolution (daemon, index, coherence-validator), and
intake dependency-claim. GitHub behavior is byte-for-byte unchanged (label vocabularies, ordering,
createPriorityResolver caching, blocked_by cycle detection). Jira refs/projects surface an explicit
`tracker_backend_unavailable` / `no-adapter` event instead of a silent not-found. Excluded: any Jira
transport, auth, native-priority mapping, or "is blocked by" link reads — those land with the Jira
adapter (#849, blocked by #2866).

Internal daemon plumbing with no user-facing capability; the only observable change is the explicit
no-adapter signal for Jira refs. Source: intake jstoup111/ai-conductor#851.
