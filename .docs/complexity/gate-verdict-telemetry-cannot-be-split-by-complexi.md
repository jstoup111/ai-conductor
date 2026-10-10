# Complexity: Gate verdict telemetry split by complexity tier

Tier: S

Rationale: The change adds one optional field to two existing `ConductorEvent` variants
(`gate_verdict`, `kickback` in `src/conductor/src/types/events.ts`), adds one pure stamping helper
that the conductor applies where it emits those two types (`emitExecutionEvent` plus the three
direct `this.events.emit` sites in `src/conductor/src/engine/conductor.ts`), and threads an optional
`tier` through two `MetricsRecorder` methods and their `MetricsListener` handlers
(`src/conductor/src/engine/otel/metrics.ts`, `metrics-listener.ts`). This is the same
additive-field path #2528 used for nine feature instruments. It adds no models, no external
integrations, no state machine, no new event type or instrument, and no CLI or config surface. It
has three stories. The governing decision is already recorded as an additive amendment to adr-014
D14. Risk is confined to emit-site coverage, which one helper and a production-order regression
bound.
