# Complexity: Report live durable intake queue depth in brain status

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one CLI verb's reporting path plus one new pure summarizer over ledger entries. It reuses the existing durable ledger reader, the existing stranded-claim predicate, and the existing configured stale-claim window; it introduces no new storage, no schema change, no new telemetry channel, and no new command, verb, or flag. The notifier and the intake loop are untouched. Small-tier architecture, conflict, and coherence artifacts are not required.
