# Complexity: Surface commit recency in daemon build progress lines

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to one additive optional event field, one cached Git probe inside the watcher's existing poll tick, one pure display formatter, and the two daemon log lines that already render these events. It reuses the existing emitter, the existing change-diffing tick, the existing quiet-episode state machine, and the existing Git runner. It introduces no new event kind, no new observer, no new ledger, no configuration key, and no schema or storage change. The quiet threshold, the halt ceilings, the post-hoc stall breaker, the interactive TTY renderer, and the OpenTelemetry span attributes are excluded. Small-tier architecture, conflict, and coherence artifacts are not required, and no ADR is created or amended: the governing intra-step build-progress ADR already names `lastCommitAt` in the quiet event's payload, and an optional field added to the sibling progress event is backward-compatible with every consumer.
