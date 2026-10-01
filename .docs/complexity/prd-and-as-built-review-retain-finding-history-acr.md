# Complexity: PRD and as-built review retain finding history across laps

Tier: L

The confirmed scope extends durable state and reconciliation across two distinct review authorities. It requires preservation of existing build-review and widening records, immutable evidence and repair/resolution provenance, bounded projections, typed semantic relationships, source completeness, restart/replay freshness, recoverable state faults, and integration with both serial and concurrent validation paths. These interacting state transitions and authority boundaries warrant the full architecture review, conflict check, and coherence check.

No new external service or provider capability is proposed: use existing shared store and native-schema seams. Implementation stays within #2440; combined routing/budget redesign and cross-gate equivalence remain successor slices. Existing parser migrations retain their separate owners. Complexity does not authorize broader scope.
