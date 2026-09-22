# Complexity: claude-weekly-limit-message-bypasses-rate-limit-re

Tier: S

Rationale: a single regex generalization in `src/conductor/src/execution/claude-provider.ts`
(`SESSION_LIMIT_RE`) plus unit tests in `src/conductor/test/execution/claude-provider.test.ts`.
No new module, seam, schema, or event; the downstream wait/no-budget-burn policy in
`conductor.ts` is unchanged and already tested.
