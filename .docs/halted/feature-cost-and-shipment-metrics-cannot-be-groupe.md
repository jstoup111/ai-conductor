# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-15T12:28:13.055Z
Slug: feature-cost-and-shipment-metrics-cannot-be-groupe
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-feature-cost-and-shipment-metrics-cannot-be-groupe
Head SHA: b1080fa533134e9e87cfa52f50492a1a2573f162
Halted at: 2026-09-15T11:57:18.542Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-1 (adr-014-otel-observability-exporter D14)

Blocking findings:
AB-1 (DESIGN; adr-014-otel-observability-exporter D14): Normal complete and halted runs record `conductor.run.outcomes` without tier before the changed tier-bearing dispatch-end branch can execute.
AB-2 (REMEDIABLE; adr-014-otel-observability-exporter D14): The configuration reference omits tier on the nine feature-scoped instruments and omits the required re-tier last-value query.
```
