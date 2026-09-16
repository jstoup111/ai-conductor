# Coherence waiver: reclaim-merged-feature-worktrees-without-depending

Waives: outcome-4

Rationale: One deliberate, operator-recorded scope exclusion.

**outcome-4 — "An operator can determine the reclaimability of every worktree in a checkout from
one command, without hand-cross-referencing branches against GitHub."** During explore the operator
chose the "filesystem-driven reap" scope and explicitly excluded an on-demand operator command
(`.docs/track/reclaim-merged-feature-worktrees-without-depending.md`, "Excluded by operator
decision"). This spec makes every worktree's disposition observable — each pass emits a
`worktree_reclaim_reclaimed | retained | failed` event per candidate with a closed-union reason,
persisted to the daemon-root ledger, and the sweep summary line reports counts — but it does not
add a single operator command that renders that reclaimability table on demand. Delivering the
command here would widen the diff beyond the confirmed scope boundary; it is recorded as a
follow-up intake issue on the Daemon operations theme rather than claimed. The other three
outcomes are delivered by the mapped stories and are not waived.
