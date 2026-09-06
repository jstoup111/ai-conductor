# Complexity: Complete assigned-issue capture for background intake

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

Two production files change: the canonical tracker seam gains an explicit result limit on one existing argv, and the intake adapter passes that limit through and reports one warning when the returned set saturates it. Everything else the poll already does — ledger dedup, handled-label skip, empty-issue skip, per-repo failure isolation, write-back, and re-eligibility — is reused untouched. No interface method is removed, no schema changes, no new module, no new telemetry channel, no configuration key, and no CLI, hook, or settings surface is affected. Small-tier architecture, conflict-check, and coherence artifacts are not required.
