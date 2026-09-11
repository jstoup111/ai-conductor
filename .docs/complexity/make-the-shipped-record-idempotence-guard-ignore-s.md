# Complexity: Shipped-record idempotence over non-telemetry substance

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one new pure projection helper beside the existing shipped-record renderers, the commit decision inside the shipped-record subcommand, and the one reference sentence that documents that decision. It reuses the existing shipment identity resolution, rendering, rollup computation, degrade-never-block error handling, and the existing staged-content guard as an inner safety net. It introduces no service, no record schema change, no storage, no configuration key, no telemetry channel, and no change to the command's flags, exit codes, or success and failure lines. The rollup computation, the post-finish refresh caller, and the sibling finish-publication existence check are excluded. Small-tier architecture, conflict, and coherence artifacts are not required.
