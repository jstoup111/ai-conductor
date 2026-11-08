# Conflict Check: Newer-engine child events vanish from OTel (#3646)

**Date:** 2026-11-07
**Stories checked:** `.docs/stories/newer-engine-child-events-vanish-from-otel-when-th.md` (Stories 1–6) against every story file whose subject overlaps OTel projection, the spool, or the executor channel
**Result:** PASS. Zero blocking conflicts; one degrading conflict, accepted by the operator.

## Inventory

Story files examined in both directions:
- `daemon-still-carries-two-feature-executors-in-proc.md` (#3333 telemetry criteria: session run id, harness version, pinned engine version, `sourceRef`, stop before `feature_dispatch_ended`)
- `engine-updates-reach-dispatched-features-only-afte.md` (unknown variants neither rendered nor persisted)
- `durable-otel-export-queue-telemetry-is-buffered-wh.md` (spool, lease, drainer)
- `trace-root-span-records-no-run-outcome-a-halted-ru.md` (root-span outcome, `terminated` on force-close)
- `mechanically-enforce-otel-handler-coverage-for-ote.md` (every OTel row has a metrics handler)
- `every-project-reports-the-same-otel-identity-so-me.md`, `stamp-released-harness-version-on-otel-trace-resou.md` (metric and trace identity)
- `daemon-dispatched-builds-emit-no-otel-telemetry-th.md`, `no-daemon-level-metrics-queue-depth-halts-and-gate.md` (daemon meter, dispatch metrics)

Narrowed out: other OTel-dimension stories (cost, buckets, gate-verdict dimensions, custom attributes). They change what a projection records, not which process records it, and the child runs the same projection code.

ADRs examined: `adr-2026-11-07-child-projected-dispatch-otel`, `adr-014-otel-observability-exporter` (D4, D7, D8, D15, D16 and amendments), `adr-2026-10-15-per-dispatch-engine-pinned-executor` (D4, D7). Narrowed out: every ADR outside OTel and the executor channel.

## Pairs judged compatible

- **#3333 telemetry criteria vs Story 6:** Story 6 asserts the same identity fields and ordering for the child-projected trace. If one is satisfied, the other still holds.
- **Pinning "unknown variant neither rendered nor persisted" vs Stories 1 and 5:** both hold. The supervisor's spine treatment is unchanged, and the OTel export comes from the child.
- **Durable spool (any provider-owning process *may* drain) vs Story 1 (the child never takes the lease):** the ADR-014 D16 wording is permissive, so a non-draining writer satisfies it.
- **Handler coverage vs Story 2:** the coverage check runs in each engine against its own registry. The child's `MetricsListener` enforces it for the child's types.
- **Identity stories vs Story 2:** the host stamps the supervisor's `project` and `worker`, keeping one metric identity.

## Conflict: A killed child cannot have its root span force-closed by the supervisor

**Stories involved:** Story 3 of `trace-root-span-records-no-run-outcome-a-halted-ru.md` vs Story 1 of this spec
**Type:** overlap
**Severity:** degrading

**Description:** Today the supervisor-side visualizer survives a dead child, and its `stop()` exports the open `conductor.run` root span with `conductor.run.outcome` `terminated`. With child-side projection, a child that hangs past the teardown timeout (and is then SIGKILLed) or is OOM-killed loses its open root span and in-flight step spans. SIGTERM and error exits stay covered, because the child's own stop path runs.

**Resolution Options:**
1. Accept the residual loss and state it accurately (ADR assumption A3), and add a criterion that the SIGTERM path exports `terminated`.
2. Keep `conductor.run` supervisor-owned and parent the child's spans under its trace context.

**Selected:** Option 1 (operator, 2026-11-07). A3 in `adr-2026-11-07-child-projected-dispatch-otel` was corrected to state the residual loss, and Story 6 gained the SIGTERM criterion.
