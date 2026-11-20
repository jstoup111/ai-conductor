# Track: remediation history handed off by file

Track: technical

Scope boundary: every history dimension of the remediation projection — prior as-built cases, pending as-built findings, prior laps, and refusals — is always handed to the remediate agent as frozen per-attempt files, with only an index inlined in the prompt. The engine splits the history into an active snapshot the agent always reads and a resolved archive of resolved prior cases the agent reads only when a current finding may be a recurrence. Small histories change delivery too (operator-accepted breaking change). A history size overflow no longer raises a needs-human halt. Excluded: the build_review remediate payload tracked in #3565, and the non-history dimensions (required references, tasks, evidence).

Engine-internal change to how remediation input reaches the agent; no user-facing capability. Source: intake jstoup111/ai-conductor#3677.
