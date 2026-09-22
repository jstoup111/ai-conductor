# Track: Claude weekly-limit message bypasses rate-limit recovery and burns the step retry budget

Track: technical

Scope boundary: minimal — fix detection only. Generalize `SESSION_LIMIT_RE` in
`src/conductor/src/execution/claude-provider.ts` so any `you've hit your <qualifier> limit` message
(weekly, daily, monthly, session, usage) classifies as a rate limit, with a test replaying the
verbatim #1006 log line. Excludes fleet-wide dispatch pausing and any change to the existing
wait/`attempt--` policy in `conductor.ts`, which already implements the non-budget-consuming
contract.

Rationale: the retry policy already exists; the only gap is the regex not recognizing the weekly
wording, so this is a daemon-internal classification fix with no operator-facing capability.
