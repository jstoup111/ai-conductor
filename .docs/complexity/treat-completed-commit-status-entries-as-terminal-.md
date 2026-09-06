# Complexity: Treat completed commit-status entries as terminal for ci-fix eligibility

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one exported classification helper in the CI-fix engine module and the shared rollup element type it reads. It introduces no new module, service, record schema, storage, configuration key, or telemetry channel, and it does not alter the attempt cap, the cooldown, the serial guard, or how the rollup is fetched. The existing non-terminal state set and the existing deferral reason format are reused as-is. Small-tier architecture, conflict, and coherence artifacts are not required.
