# Complexity: Skip registered projects whose path is missing

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to the poll loop of one existing adapter module: a liveness test before the
GitHub call, a per-adapter record of which registrations are already reported, and a corrected
diagnostic. It reuses the module's existing `existsSync` import, its existing injected log sink, and
its existing per-repo isolation contract. It adds no module, no interface change, no record schema,
no configuration key, no telemetry channel, and no third-party call. Registry repair, de-registration,
and durable registration health are excluded. Small-tier architecture, conflict-check, and coherence
artifacts are not required.
