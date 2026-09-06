# Complexity: Reclaim orphaned full-suite lock recovery claims

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to the recovery-claim branch of one engine module and its existing test file. It adds a claim parser and an orphan classification that reuse the module's existing injected `clock`, `processIsLive`, and `unownedStaleMs` seams, then threads them into the one call site that already computes them. It introduces no configuration key, no record-format change, no service, no storage, and no telemetry channel, and it leaves owner liveness, quarantine, release, timeout budget, and evidence handling untouched. Small-tier architecture, conflict, and coherence artifacts are not required.
