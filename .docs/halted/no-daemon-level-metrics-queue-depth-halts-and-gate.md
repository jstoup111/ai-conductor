# Halt record

Status: halted
Slug: no-daemon-level-metrics-queue-depth-halts-and-gate
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-no-daemon-level-metrics-queue-depth-halts-and-gate
Head SHA: d806292d5d57a5bce55fb5a57119dd10fdd4d27d
Halted at: 2026-09-08T16:05:12.256Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-5 (adr-014-otel-observability-exporter D8)

Blocking findings:
AB-1 (REMEDIABLE; Task 19): metricsHandledEventTypes is exported from production code but has only a test caller.
AB-2 (REMEDIABLE; Task 9): onBacklogDiscovered is a production interface hook whose optional-call precondition is never supplied.
AB-3 (REMEDIABLE; adr-014-otel-observability-exporter D4): MetricsListener scans all daemon-wide open step keys when one dispatch ends.
AB-4 (REMEDIABLE; adr-014-otel-observability-exporter D9): DiscoverySnapshot excludes parked, so parked oldest state-residence age cannot be produced.
AB-5 (DESIGN; adr-014-otel-observability-exporter D8): daemon.stalls is feature-scoped in source and Story 5 but forbidden by the latest ADR and Story 2 wording.
AB-6 (REMEDIABLE; Task 9): A full worker pool has no onTick caller despite the required busy-pool branch.
```
