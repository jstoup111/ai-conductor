# Intake origin: daemon-autonomous-runs-must-fail-closed-on-any-amb

Source-Ref: jstoup111/ai-conductor#550
Owner: jstoup111

## Desired outcome

- In daemon mode, DECIDE-phase steps (explore/prd/complexity/architecture-diagram/architecture-review/stories/conflict-check/plan) can NEVER dispatch an authoring session: satisfied → fast-forward; unsatisfied → HALT naming the missing artifact. Observable by deleting a spec artifact from a test feature and watching the daemon halt rather than author.
- Interactive `/conduct` behavior unchanged (DECIDE authoring is legitimate with a human present).
- Negative path: the fast-forward verification of existing artifacts stays cheap (no added dispatches for the healthy case).
