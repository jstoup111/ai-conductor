# Complexity: base-inherited protected-artifact deletion deadlocks seal rotation and reseal

Tier: M

## Rationale

- One primary module (`src/conductor/src/engine/protected-artifact-seal.ts`): the deletion loop in
  `inspectSeal`, the scoped reseal path (`createScopedProtectedArtifactSeal` /
  `resealProtectedArtifactSeal`), seal persistence (`rebaselines`), and refusal reason text.
- Changes a security-relevant invariant: the engine will now automatically prune base-deleted paths
  from the DECIDE seal. That trust decision warrants an ADR via lightweight architecture review.
- Audit record rides the existing `rebaselines` entry and rebaseline observer (event spine) — no new
  channel, no new state machine, no external integration.
- Expected story count: 4–5 (inherited deletion tolerated + pruned, feature-authored deletion halts,
  reseal recovers, refusal attribution, provenance-undeterminable fail-closed).
- Technical track; operator selected Approach C (tolerate + prune with audit); absorbs #1676.
