# Complexity: Lock #474's breaking surfaces before v1

Tier: L

Rationale: parallel task-stream dispatch introduces concurrency primitives into the conductor
build loop (stream detection, semaphore-capped dispatch, join), touches four consumer-visible
surfaces (hook wiring, settings.json schema, task-status/current-task semantics, config keys),
couples to attribution/evidence machinery (#433/#531/#535 classes), and must stay consistent
with #469's GroupCore ADRs. Multiple state machines, cross-cutting invariants, and
forward-compatibility obligations → Large. Full architecture-diagram, architecture-review,
and conflict-check are required (no tier skips).
