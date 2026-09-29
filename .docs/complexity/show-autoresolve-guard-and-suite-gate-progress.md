# Complexity: Show autoresolve guard and suite gate progress

Tier: S

Operator scope: small, confirmed 2026-09-28 (delegated); issue is labeled size S.

The change adds one ConductorEvent variant, its sink declaration, and three log lines plus three best-effort emissions at two existing points in resolveConflictingPr. Three production files change: src/conductor/src/types/events.ts, src/conductor/src/engine/event-sinks.ts, and src/conductor/src/engine/autoresolve.ts. No new service, storage, ledger, configuration key, CLI surface, or ADR. Failure paths are untouched. Tests extend the existing real-git autoresolve integration fixture and the two exhaustive event registries. Small-tier architecture, conflict, and coherence artifacts are not required.
