# Complexity: prd_audit passes on a partial report

Tier: M

## Rationale

Medium, not Small. The change is confined to one engine module plus one skill, but it is not a
localized edit:

- **Multiple coupled read sites.** The blocking-row predicate has four consumers
  (`artifacts.ts:681`, `:2257`, `:2300`, and `classifyPrdAuditGaps:3267`), each with different
  semantics — sweep-sparing, preserve, pass, and daemon routing. All four must agree on what
  "complete" means, and a partial fix silently leaves the fail-open path alive.
- **Interacts with existing preservation machinery.** The design deliberately rides
  `gateVerdictStillValid` / the `#817` code-stamp for the partial-vs-full re-audit decision, and
  must not regress `#655`'s delta-aware rebase preservation of `prd_audit`.
- **Changes a gate's pass signal.** Moving the authority from a markdown table to a structured
  manifest touches the completion predicate, the sweep, and the daemon's kickback classification —
  the exact surface where a mistake produces either a false ship or a churning kickback loop.
- **A migration concern.** An in-flight feature holding only the old markdown report must not be
  bricked by the new manifest requirement.

No new models, integrations, auth, or state machines are involved, and there is no user-facing
surface — which keeps it below Large.

Because the tier is M, DECIDE runs `/architecture-diagram`, a lightweight `/architecture-review`,
`/conflict-check`, and `/coherence-check`; `/prd` is skipped on the technical track.
