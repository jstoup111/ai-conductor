# Complexity: Keep containment advisories out of build_review's failure reason

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one pure string-ordering helper beside the existing advisory renderer, the one closure in the `build_review` step runner that applies it, and a sentence of gate documentation. It adds no configuration key, no event variant, no artifact, and no new module. It changes no verdict, no retry policy, and no containment check. Small-tier architecture, conflict-check, and coherence artifacts are not required.
