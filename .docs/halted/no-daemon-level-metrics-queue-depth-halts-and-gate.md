# Halt record

Status: halted
Slug: no-daemon-level-metrics-queue-depth-halts-and-gate
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-no-daemon-level-metrics-queue-depth-halts-and-gate
Head SHA: 586df9b2fb3ad680caa5a235289d72faae83f3eb
Halted at: 2026-09-08T02:54:24.608Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-6 (adr-014-otel-observability-exporter D7), AB-7 (adr-014-otel-observability-exporter D8), AB-10 (Story 3)

Blocking findings:
AB-1 (REMEDIABLE; Task 19): metricsHandledEventTypes is exported from production code but has only a test caller.
AB-2 (REMEDIABLE; adr-014-otel-observability-exporter D4): MetricsListener scans all open step keys when one feature dispatch ends.
AB-3 (REMEDIABLE; adr-014-otel-observability-exporter D9): Snapshot emission is not one-to-one with discovery and poll duration includes non-discovery work.
AB-4 (REMEDIABLE; Task 21): A setup-triage park returns after a dispatch start without emitting feature_dispatch_ended.
AB-5 (REMEDIABLE; Task 14): Halt-step attribution reads phase-active after Conductor has removed it, producing unknown instead of the halting step.
AB-6 (DESIGN; adr-014-otel-observability-exporter D7): Trace service.instance.id changed to project/worker even though D7 says traces are unaffected.
AB-7 (DESIGN; adr-014-otel-observability-exporter D8): daemon.inflight carries feature despite D8 forbidding feature on daemon-level instruments; D9 and Story 3 require the conflicting shape.
AB-8 (REMEDIABLE; adr-014-otel-observability-exporter D9): No oldest-age value can be produced for the parked backlog state.
AB-9 (REMEDIABLE; Task 3): The required worker_name entry is absent from the project config scaffolder template.
AB-10 (DESIGN; Story 3): The immutable first-discovery marker cannot represent time entering the eligible state.
```
