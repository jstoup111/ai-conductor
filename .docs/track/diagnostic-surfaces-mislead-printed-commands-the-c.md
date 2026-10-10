# Track: Diagnostic surfaces mislead — rejected remediation commands and non-durable episode HALT state

Track: technical

Scope boundary: Balanced, two defects only. (1) Every remediation command the conductor CLI prints
comes from a single builder whose outputs are proven to parse; the two `ai-conductor --reset` strings
in `src/conductor/src/index.ts` are corrected, and a source check rejects hand-written command
literals. (2) Episode-caused HALT stamps survive a daemon restart via durable per-worktree state, so
both a startup sweep and the episode-end sweep recover them. Excluded: the intake's `--report`
halt/kickback item (operator: `--report` is a removal candidate superseded by OTel — a separate idea),
and remediation strings outside the conductor CLI's printed guidance.

Internal daemon/CLI tooling fixes with no product requirements; acceptance criteria live in stories.
Source: intake jstoup111/ai-conductor#1023 (narrowed to current-main state).
