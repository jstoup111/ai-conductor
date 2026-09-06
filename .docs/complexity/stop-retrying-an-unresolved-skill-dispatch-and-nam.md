# Complexity: Stop retrying an unresolved skill dispatch and name its remedy

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one early return in the existing auxiliary retry loop, one pure detail-
rendering helper beside the existing dispatch-failure constructor, propagation of two fields already
declared on the provider contract through one private dispatch helper, and one already-optional
field on an existing event variant. It introduces no new module, no configuration key, no CLI
surface, no event variant, no record schema, and no storage. It reuses the existing provider
contract, the existing dispatch-failure envelope, and the existing infrastructure-failure branch.
Pre-dispatch preflight and provider parity for the unresolved-command signal are excluded and
tracked elsewhere. Small-tier architecture, conflict, and coherence artifacts are not required.
