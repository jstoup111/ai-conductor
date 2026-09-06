# Complexity: Name the directing text when remediation redirects a gap away from build

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one private engine helper that already computes the clause it must now report, the single call site that emits the existing redirect event, the one evidence string that already feeds the halt renderer, and the renderer case that already prints the event. Three production files change and no new module is introduced. It adds optional fields to one existing member of the event union rather than a variant, a ledger, a file, or a channel, so no consumer is obliged to change and no ADR is triggered. The detector's verb vocabulary, its clause boundaries, the redirect's routing target, and the ungrantable-step policy are all unchanged. Small-tier architecture, conflict-check, and coherence artifacts are not required.
