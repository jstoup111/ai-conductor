# Complexity: OTel projection runs in the version-matched child executor (#3646)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None persisted. One new engine module provides a proxy OTel `Meter` in the child and the matching supervisor-side instrument host |
| External integrations | None new. Spans still reach the backend only through the existing `.daemon/otel-spool`, drained by the supervisor's lease holder (ADR-014 D15, D16) |
| Auth / permission surface | None. OTLP header values stay in the drainer process, and the child writes spool files only (D15: header values are never written) |
| State machines | The executor hello gains a projection capability that is negotiated per dispatch. A capable child projects its own spans and metrics, and the supervisor stops projecting that child's events. An older child keeps today's supervisor-side projection. The once-per-feature run-outcome dedupe must survive the move from a long-lived listener to a per-dispatch one |
| Story count | ~5: child-side spans at any skew; child-side metrics through the supervisor meter; no double projection and older-child compatibility; child-local types stay out; #3333's dispatch-trace identity is preserved (run id, `service.version`, pinned engine version, `sourceRef`, flush before `feature_dispatch_ended`) |
| Files touched | ~15: `engine/executor-child.ts`, `engine/executor-protocol.ts`, `engine/executor-broker.ts`, `daemon-cli.ts`, `engine/otel/wire.ts`, `engine/otel/spool-wiring.ts`, `engine/otel/metrics-listener.ts`, `engine/otel/metrics.ts`, a new brokered-meter module, and about six test files |
| ADR work | Amends `adr-2026-10-15-per-dispatch-engine-pinned-executor` D4 (unknown variants and the supervisor-side visualizer) and `adr-014-otel-observability-exporter` D7 (the one meter is fed by the child's projection through a brokered `Meter`, not only by root-bus events) |

## Rationale

Large. The operator requires every OTel span and metric that the child's engine declares to reach
the backend, whatever the child's pin is relative to the supervisor's. Verified in code: the
supervisor's visualizer and `MetricsListener` subscribe only to their own registry's OTel types and
hold per-type projection code, so a stale supervisor cannot export a newer type, whether the type
is forwarded or not. The only skew-proof design runs the projection in the process that emitted
the event. That moves both OTel signal paths across the executor process boundary. It amends two
APPROVED ADRs, and it must keep ADR-014 D7's single long-lived `MeterProvider` and the
spool-ownership rules, so it needs a full architecture review. The operator's M sizing is raised to
L. It touches the same broker attach and close code that #3333 rewrites, so it is blocked by #3333.
