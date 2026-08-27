# Complexity: bin/setup re-runs on every dispatch instead of once per worktree

Tier: M

Rationale: Daemon dispatch-lifecycle change with durable per-worktree state (setup-success
marker + invalidation predicate spanning rebases and script drift), a new optional per-dispatch
lifecycle script, triage-path preservation, and documentation. No new models, integrations,
auth, or multi-actor state machines — below L; more than a localized fix — above S. Matches the
intake issue's `size: M` label.
