# Complexity: Reclaim merged feature worktrees without depending on the mergeable watch registry

Tier: M

## Rationale

**Medium**, matching the `size: M` label on `jstoup111/ai-conductor#1510`.

Sizing drivers:

- No new removal module. The existing parked-feature reconciliation sweep is widened to
  enumerate git-registered worktrees under `.worktrees/`, and every candidate is fed one at a
  time to the existing guarded helper `reconcileMergedPark`; no new process, no new persistence
  format, no schema migration.
- The helper gains two bounded extensions: it accepts the worktree's listed branch instead of
  re-deriving it from the slug, and its shipped-record precondition is scoped to `feat/daemon-*`
  branches. Its multi-proof authority, teardown invitation, and refusal taxonomy are unchanged.
- The weight is not in the mechanism but in the **safety envelope**. This path deletes
  directories, so it must satisfy the repo's hard rule against operating on a computed set,
  must never reclaim in-flight, parked, or halted work, must fail open toward retention on any
  indeterminate probe, and must justify itself against an approved ADR that currently scopes
  reclaim to a single-slug operator verb. That reconciliation requires an ADR amendment.
- Two approved ADRs need amendments (`adr-2026-08-01` record-as-precondition scope and
  candidate-set widening; `adr-2026-07-29` D6 single-slug operator verb versus automatic
  enumeration), a new config key must enter the consumer registry, and three `ConductorEvent`
  variants must be declared in `EVENT_SINKS`.
- Test surface is moderate: worktree-listing enumeration, per-candidate exclusion branches,
  branch-from-listing evidence, the scoped record precondition, event emission, and the
  single-removal-per-pass property.

Not Small: it widens a destructive automatic path, amends two ADRs, and adds a config key and
event variants. Not Large: one module widened, one composition-root change, no consumer-visible
CLI or schema surface beyond an additive boolean config key.

## Tier consequences

Medium requires `/architecture-diagram`, a **lightweight** `/architecture-review`,
`/conflict-check`, and `/coherence-check`. Technical track, so no PRD.
