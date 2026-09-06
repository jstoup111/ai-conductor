# Complexity: Let an operator park settle without a needs-human halt

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one guard inside the conductor's existing markerless-exit backstop: a run that already returns the typed operator-parked termination stops writing a halt marker for that exit. It introduces no new module, marker, halt class, event, metric, configuration key, CLI flag, or schema, and it changes no dispatch, park, unpark, re-kick, or dashboard logic. One production file is edited; the remaining work is the unit, acceptance, and verification coverage that proves the exemption is scoped to a real park and that a genuinely markerless exit keeps its existing needs-human halt. Small-tier architecture, conflict-check, and coherence artifacts are not required, and no ADR is created or amended.
