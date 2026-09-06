# Complexity: Enforce the plan task-count hard stop at land

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one focused engine module holding the band thresholds, a classifier over text the
existing plan-task parser already produces, and a declaration validator; wires a single refusal into
the land gate's existing plan-validation block; and rewrites one section of one skill. It reuses the
shared task-header grammar, the existing pure-predicate gate shape, and the existing `landSpec:`
error path. It introduces no service, schema, storage, configuration key, CLI subcommand, event,
metric, or telemetry channel, and changes no hook wiring or skill symlink target. Threshold
recalibration and warning-band authoring behavior are excluded. Small-tier architecture, conflict,
and coherence artifacts are not required, and no ADR is created or amended.
