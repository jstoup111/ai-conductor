# Complexity: fresh-session-per-step

Tier: S

## Signals
- MODELS: 0 (no data model changes)
- INTEGRATIONS: 0 (internal session lifecycle only)
- AUTH: 0
- STATE_MACHINES: 0 (session create/resume is a trivial two-state marker, not a new machine)
- STORIES: ~4

## Rationale
A tightly-scoped refactor of the conductor's per-step session lifecycle: remove the
`freshContextPerStep` opt-in gate so `resetSession()` runs before every step across all
phases, keep the existing within-step retry-resume shape, drop the daemon's flag set, and
audit front-half steps for conversational-recall dependence. No models, integrations, auth,
or new state machines. Small tier → architecture-diagram, architecture-review, and
conflict-check are skipped; proceed track → complexity → stories → plan.
