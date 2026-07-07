# Complexity: self-host release gate — migration-gate waiver

Tier: M

## Rationale

- Changes fail-closed gate semantics governed by an APPROVED ADR
  (adr-2026-06-30-halt-based-release-gates) — the waiver must provably preserve the
  fail-closed default and the ADR-005 human-merge invariant.
- Introduces a new committed artifact contract (waiver format, scoping to the exact
  change set, surface naming) consumed by `runReleaseArtifactGate` (TR-10).
- Requires adversarial negative paths: stale waiver from a prior slug, waiver naming
  fewer surfaces than the diff touches, waiver present with no breaking surfaces,
  malformed waiver.
- No new external integrations, auth, services, or state machines; single repo,
  self-host path only → not L. Gate-semantics blast radius → not S.

Per tier M: architecture-diagram required, lightweight architecture-review, stories,
conflict-check, plan. Technical track — no PRD.
