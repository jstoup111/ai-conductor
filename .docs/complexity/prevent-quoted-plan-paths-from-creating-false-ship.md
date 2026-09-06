# Complexity: Correct shipment association for PR checks

Tier: S

Operator scope: small, confirmed 2026-09-06.

The change is bounded to premerge declaration parsing and diagnostics, the existing implementation-PR metadata producer needed to retain automatic binding, and the existing workflow's edited trigger. It reuses the strict verifier, Git diff classification, and immutable event payload. It introduces no service, record schema, storage, or new telemetry channel. Historical association and reconciliation redesign are excluded. Small-tier architecture, conflict, and coherence artifacts are not required.
