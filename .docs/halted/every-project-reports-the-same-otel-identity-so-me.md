# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-08-28T22:39:37.636Z
Slug: every-project-reports-the-same-otel-identity-so-me
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-every-project-reports-the-same-otel-identity-so-me
Head SHA: d54a13ef7e93a458cd603b2b0a0c2cec8c8e09eb
Halted at: 2026-08-28T22:24:25.723Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-1 (REMEDIABLE; adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal decision 4): The documented `otel.project_name` key has a real consumer but no own declaration in the required total config-key consumer registry.
AB-2 (DESIGN; jstoup111/ai-conductor#1938 desired outcome 4): Per-run `conductor.run.id` changes the `target_info` label set, so the approved design still creates an unbounded series over accumulating runs.
```
