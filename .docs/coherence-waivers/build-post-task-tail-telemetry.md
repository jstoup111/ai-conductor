Waives: outcome-2, outcome-3, outcome-5

Rationale: All three are intake outcomes from jstoup111/ai-conductor#1176 that this spec
deliberately does not implement, each for a reason established by measurement during DECIDE
rather than by scope-trimming.

**outcome-2** ("a completed task graph reaches BUILD completion without unconditional idle
time") is already satisfied and needs no work. Across all 43 worktree event ledgers — 28 `build`
windows, 24 with a usable task-completion tick — every re-entry shows `provider ≈ active ≈ wall`
(6.8/6.6, 14.9/14.8, 5.1/5.0 minutes). The build step is ~97% LLM session time; there is no
unconditional idle to remove. The intake's cited fixed cooldowns total 15 seconds against tails
of 4-27 minutes.

**outcome-3** ("equivalent verification or judgment evidence is produced once and reused by
downstream gates while it remains current") is deferred to a v1 follow-up that is blocked on this
telemetry. Reusing evidence is only safe once the rollup can distinguish a closeout obligation
that genuinely repeated from one doing new remediation work — a distinction the ledger cannot
express today. Acting on it first risks skipping verification of code committed during a
re-entry.

**outcome-5** ("on representative no-rework builds, the p95 post-task tail is reduced by at least
50% from a baseline captured after #1101 lands") is out of scope because the metric as written is
not sound. "Time after all plan tasks resolve" conflates two different things: 19 of 24 measured
windows are re-entries that begin with the task graph already fully resolved, so kickback
remediation counts entirely toward the "tail". ~197 of the 202 measured tail-minutes are real
repair work — the sessions' own summaries record commits `3b91faa29`, `8ba2d35be`, `6a97b6e16`
and FR-8/FR-9 remediation. A 50% reduction against that metric could be achieved by shipping less
work. Re-targeting it against a commit-quiet closeout measure is recorded as a follow-up action
in `.docs/decisions/adr-2026-08-08-pipeline-owned-closeout-timestamps.md`, and this spec produces
the baseline that re-targeting requires.
