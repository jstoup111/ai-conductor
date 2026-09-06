# Complexity: Compose the spec PR body with its release disposition

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

Two production files change: the existing spec-PR release-metadata module gains a pure body composer and a small argument builder, and the handoff opener passes those arguments to the create call instead of relying solely on autofill. No new module boundary, no schema, no configuration key, no CLI surface, no hook wiring, and no telemetry channel. The opt-in predicate, the default block, the author-wins rule, the non-fatal contract, and the post-create repair are all reused unchanged. Test work extends one existing test file and adds one focused unit file. Small-tier architecture, conflict-check, and coherence artifacts are not required.
