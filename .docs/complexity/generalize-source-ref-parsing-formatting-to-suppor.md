# Complexity: Generalize source-ref parsing/formatting to support Jira keys

Tier: M

## Rationale

- No heavy signals: no new models, no external integrations (no Jira API client in
  this slice), no auth, no state machines.
- But it is a cross-cutting refactor of the grammar behind the intake ledger's
  idempotency key (`source + sourceRef`, ADR-009), touching 5 divergent parser
  sites (`engineer/issue-ref.ts`, `intake/label-sync.ts`,
  `issue-dep-migration.ts`, `backlog-priority.ts`, `pr-labels.ts`) plus intake
  markers and writeback paths — a regression in any one silently corrupts dedup
  or drops writebacks.
- Estimated 4–6 stories; behavior-preservation for existing GitHub refs is a hard
  acceptance constraint.

Medium ⇒ architecture diagram required, lightweight architecture review,
conflict-check required.
