# Complexity: Routed build claim with null fields is rejected as malformed and discarded (#3643)

Tier: S

Rationale: two localized engine changes on one boundary, the routed BUILD claim settlement.
`src/conductor/src/engine/routing/prerequisite-claim.ts` makes `parseBuilderClaim`'s `malformed`
result carry a field-level detail that `settleRoutedBuildClaim` returns as the failed-attempt detail.
`src/conductor/src/engine/conductor.ts` lets a present `.pipeline/halt-user-input-required` marker
take precedence over routed claim settlement, so the attempt reaches the existing halt-marker stall
handling. Roughly 30 production lines with focused parser, settlement, and conductor tests. No new
module, dependency, schema, CLI flag, hook, persisted format, or ADR: the provider claim schema and
the halt-marker contract (adr-2026-07-10-daemon-stall-remediation) are unchanged. Not a hotfix: it
is two logical changes (diagnostic detail and marker precedence) across about 30 lines, beyond the
two-file, ~15-line, one-change bound. Codex null normalisation is already on main
(`fromCodexStrictResult`, #3581 and #3589), so desired outcome 1 needs only a regression criterion.
Per tier rules: no PRD (technical track), no architecture-diagram, architecture-review,
conflict-check, coherence-check, or plan-review.
