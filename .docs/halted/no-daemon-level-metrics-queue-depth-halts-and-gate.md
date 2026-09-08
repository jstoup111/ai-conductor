# Halt record

Status: halted
Slug: no-daemon-level-metrics-queue-depth-halts-and-gate
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-no-daemon-level-metrics-queue-depth-halts-and-gate
Head SHA: bbe4f73e1ade902fd2d885ed1b75426b7dbe4769
Halted at: 2026-09-08T17:37:28.870Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-4 (adr-2026-07-28-total-halt-classification-legacy-boundary D2)

Blocking findings:
AB-1 (REMEDIABLE; Task 19): Listener coverage checks subscriptions, not actual handler cases, and the listener no longer derives subscriptions from the sink registry.
AB-2 (REMEDIABLE; adr-014-otel-observability-exporter D5): Daemon metric flush and shutdown failures can escape telemetry teardown and change or wedge the run.
AB-3 (REMEDIABLE; Task 9): Full-pool snapshots hardcode unsampled blocker flags and replay stale discovery duration.
AB-4 (DESIGN; adr-2026-07-28-total-halt-classification-legacy-boundary D2): Sealed Story 4 and current telemetry classify an absent sidecar as legacy despite the APPROVED ADR's fail-closed unclassified rule.
```
