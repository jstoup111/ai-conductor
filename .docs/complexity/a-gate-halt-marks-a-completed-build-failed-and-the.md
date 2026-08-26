# Complexity: a-gate-halt-marks-a-completed-build-failed-and-the

Tier: M

Rationale: single-repo engine change, no new integrations or auth, but it widens a core state
union (`StepStatus`) consumed by the conductor loop, gates, state persistence, renderers, and the
daemon, adds a new spine event (`step_refused`), and touches three distinct halt paths plus the
gate-blocked exit path. Roughly 5 stories; well above S, no L signals (no new models, providers,
or state machines).
