# Complexity: BUILD post-task tail telemetry

Tier: M

## Rationale

Signals assessed against the standard set (models, integrations, auth, state machines,
story count):

- **No** new models, no external integrations, no auth surface, no new state machine.
- **Yes** to a durable contract change: `build_progress` gains tick provenance and a new
  closeout-observation event joins the `ConductorEvent` union in
  `src/conductor/src/types/events.ts`. That ledger is consumed by the daemon log, the UI,
  OTel export, and the existing `computeTimingRollup`, so the schema is a real contract
  rather than a private field.
- **Yes** to a new operator-facing reporting surface (the tail rollup and its CLI
  entrypoint), which carries documentation obligations under this repo's Documentation
  Upkeep rule (`docs/reference/cli.md`, `docs/reference/steps.md`).
- Estimated 5-7 stories across: watcher tick provenance, closeout-artifact observation,
  the rollup module, the CLI surface, and the committed baseline.

Not Small: an S tier would skip `architecture_review`, and the event-schema contract
change plus the engine-to-skill artifact-path coupling (see the open ADR question in the
architecture review) is exactly the kind of decision that should be recorded in an ADR.

Not Large: contained to a handful of engine modules with no cross-cutting migration, no
concurrency redesign, and no change to gate semantics or step ordering.
