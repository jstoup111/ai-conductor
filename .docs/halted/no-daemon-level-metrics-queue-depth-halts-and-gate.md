# Halt record

Status: halted
Slug: no-daemon-level-metrics-queue-depth-halts-and-gate
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-no-daemon-level-metrics-queue-depth-halts-and-gate
Head SHA: af75155ce043e7a8ccce02b926a762a39f63378e
Halted at: 2026-09-08T03:59:15.723Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-12 (Story 4)

Blocking findings:
AB-1 (REMEDIABLE; Task 19): metricsHandledEventTypes is exported from production code but has only a test caller.
AB-2 (REMEDIABLE; adr-014-otel-observability-exporter D4): MetricsListener scans all open step keys when one feature dispatch ends.
AB-3 (REMEDIABLE; adr-014-otel-observability-exporter D9): Snapshot emission is not one-to-one with discovery, and poll duration measures the whole loop tick rather than discovery.
AB-4 (REMEDIABLE; Task 21): Setup-triage park returns after dispatch start without emitting feature_dispatch_ended.
AB-5 (REMEDIABLE; Task 14): Halt-step attribution reads phase-active after Conductor removed it, yielding unknown.
AB-6 (REMEDIABLE; adr-014-otel-observability-exporter D7): Trace identity changed from project/feature to project/worker and gained conductor.worker despite the approved byte-identical contract.
AB-7 (REMEDIABLE; adr-014-otel-observability-exporter D8): Daemon metric Resource sets conductor.project to basename(projectRoot), not the absolute project root.
AB-8 (REMEDIABLE; adr-014-otel-observability-exporter D9): DiscoverySnapshot excludes parked, so no parked oldest-age value can be produced.
AB-9 (REMEDIABLE; Task 3): The required commented otel.worker_name entry is absent from the project config template.
AB-10 (REMEDIABLE; Task 10): Backlog age remains immutable first-ever-discovery time instead of resetting on state transitions.
AB-11 (REMEDIABLE; Task 15): Shipment timing directly reads and parses conduct-state.json instead of using the approved readState contract.
AB-12 (DESIGN; Story 4): Missing-sidecar and pre-sidecar HALTs are indistinguishable, but the sealed criteria require different labels.
```
