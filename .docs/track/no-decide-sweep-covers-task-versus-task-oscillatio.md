# Track: No DECIDE sweep covers task-versus-task oscillation inside a plan (#1540)

Track: technical

Scope boundary: Minimal — skill prose only, no engine or parser change. `/coherence-check` gains a task↔task oscillation sweep (both-directions question over task pairs sharing a behavior, entity, file, or fixture); a grounded finding marks the affected existing `task` row `fail`, which the land-time coherence gate already treats as blocking. `/plan`'s verification checks separate "dependencies are acyclic" from "tasks do not invalidate each other" and point the latter at `/coherence-check`. `/conflict-check`, `/coherence-check` (and `/plan` where it states the split) state which skill sweeps which layer pair (story↔story, cross-layer, task↔task), so an unowned layer is visible from the skill text. Excluded: new coherence row classes, engine-side candidate-pair enumeration, any mechanical layer-ownership check, and any new required step for S-tier specs.

Harness skill-prose change adding a DECIDE check; no user-facing product requirements warrant a PRD.
