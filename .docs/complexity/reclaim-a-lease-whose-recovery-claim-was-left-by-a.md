# Complexity: Reclaim a lease whose recovery claim was left by a dead process

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one engine module and its existing unit test file. It adds a validator and parser for the recovery-claim record modelled on the owner record's, routes the already-held claim branch through the module's existing injected liveness probe, replaces the acquire loop's single live-owner pid with a blocker descriptor that names either a live owner or a live recovery claim, and treats an absent quarantine source as a retry rather than a refusal. It reuses the existing filesystem seam unchanged, the existing diagnostic callback, and the existing atomic quarantine sequence. It introduces no service, no record schema beyond the claim shape the module already writes, no storage, no configuration key, and no new telemetry channel. The public failure-kind union and every call site are untouched. The full-suite lock carrying the same defect pattern is filed and specced separately. Small-tier architecture, conflict, and coherence artifacts are not required.
