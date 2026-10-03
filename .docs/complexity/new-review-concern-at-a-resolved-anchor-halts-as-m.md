# Complexity: New review concern at a resolved anchor halts as malformed case state

Tier: M

## Rationale

- Changes a durable-state invariant in `remediation-case-store.ts` (global one-case-per-source
  ownership becomes lifecycle-scoped) that existing readers index against, so every
  source→case reader must be reconciled with the new rule.
- Extends the case-v2 judgement schema and validator with an explicit distinct-from declaration,
  and the adjudication context/prompt that tells the judge when to use it.
- Reconciler binding rules change (undeclared reuse of a resolved case's source becomes a bound
  recurrence → `halt-regression`), plus a new typed rejection distinct from `malformed-state`
  surfaced by the adjudication coordinator.
- Governed by `adr-2026-08-29-build-review-remediate-case-adjudication`; the change needs an
  approved additive amendment, not a new subsystem — Medium, not Large.
- No new external integrations, no migration of persisted history (existing stores stay valid).
