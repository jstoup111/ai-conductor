# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-08-28T21:51:16.090Z
Slug: every-project-reports-the-same-otel-identity-so-me
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-every-project-reports-the-same-otel-identity-so-me
Head SHA: 43d0ac9702b49e0949097d0b9cadeb8fa0d6737f
Halted at: 2026-08-28T16:53:34.947Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-1 (REMEDIABLE; adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal decision 4): The new documented `otel.project_name` key has no declaration in the required total config-key consumer registry.
AB-2 (DESIGN; jstoup111/ai-conductor#1938 desired outcome 4): Per-run `service.instance.id` becomes Prometheus's per-metric `instance` label, so metric series cardinality grows with every run despite the approved bounded-growth claim.
```
