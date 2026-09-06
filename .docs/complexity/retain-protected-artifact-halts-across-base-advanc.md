# Complexity: Retain protected-artifact halts across base-advance sweeps

Tier: S

Rationale: One missing case in the existing shared retention predicate, one existing sweep test fixture/matrix to extend, and no new integration, schema, event, dependency, or recovery algorithm. Two bounded tasks cover the complete issue, including negative behavior and compile-time exhaustiveness. Technical track; architecture, conflict-check, and coherence artifacts are skipped under composer's Small-tier routing.
