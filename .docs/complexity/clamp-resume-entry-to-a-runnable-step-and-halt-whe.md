# Complexity: Clamp the resume entry to a runnable step

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to the resume branch of one engine method and one existing exported selection helper in the same file, plus the acceptance file that already owns resume-entry behavior. It reuses the existing verdict read, the existing backward-only prerequisite walk, the existing decide-entry disposition, and the existing halt marker and loop-halt event; it introduces no new event, metric, artifact, config key, CLI flag, schema, or state field, and mutates no persisted state. No architecture decision changes: the approved verdict-aware-resume ADR already specifies a backward-only clamp on the local start index with `checkGate` as the loop's entry predicate, and this slice widens when that reconciliation runs rather than what it decides. Small-tier architecture, conflict, and coherence artifacts are not required.
