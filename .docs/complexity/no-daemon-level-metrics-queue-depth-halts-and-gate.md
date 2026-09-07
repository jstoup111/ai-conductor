# Complexity: No daemon-level metrics: queue depth, halts and gate outcomes are events-only

Tier: L

Rationale: Moves MeterProvider ownership from per-dispatch visualizers to the daemon process
(refactor of `src/conductor/src/engine/otel/`), amends adr-014's metric identity contract
(`service.instance.id` becomes `<project>/<worker>`, new `worker` dimension), adds ~4 typed
`ConductorEvent` variants with EVENT_SINKS rows and visualizer handlers, and adds ~15 instruments
across daemon, feature, and gate scopes. Touches daemon-cli wiring, daemon loop, halt/ship paths,
and the interactive path must remain byte-for-byte unchanged in behavior. Requires full
architecture review, conflict check, and coherence check.
