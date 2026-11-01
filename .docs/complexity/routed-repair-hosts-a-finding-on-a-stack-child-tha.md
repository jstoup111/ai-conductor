# Complexity: Routed repair hosts a finding on a stack child that lacks its target file

Tier: M

Rationale: The fix stays inside the existing routing module (`src/conductor/src/engine/routing/`) and
introduces no new state, ref, event variant, config key, CLI or HALT class. It still touches four
production files whose behaviour an approved ADR fixes:
`cited-repository-paths.ts` (citation token cleanup), `cannot-host.ts` (citation resolution against
the leaf tree and directory handling for D4 host selection), `prerequisite-claim.ts` (D5 claim
verification on the same resolved evidence, tolerant of directory entries already persisted in open
route records), and `round-router.ts` (the admission check over each host's allocated rem blocks).

The change redefines what counts as a cited path and a prerequisite input in
`adr-2026-10-12-routed-whole-feature-repair` decisions 4 and 5, so that on-main ADR needs an approved
amendment. A wrong resolution rule mis-hosts every routed finding in a stacked feature, so the work
needs the Medium architecture pass and a conflict check against the other open routing specs. It is
not Large: it adds no subsystem or cross-boundary contract, and it leaves N=1 and unsliced features
untouched because they never enter routing.
