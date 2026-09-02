# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-09-01T14:04:34.601Z
Slug: when-bypasses-gating-enforcement-while-disable-is-
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-when-bypasses-gating-enforcement-while-disable-is-
Head SHA: 96064987a5718097350818bc1d1b520ea49f194c
Halted at: 2026-08-31T18:05:08.451Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-1 (DESIGN; 004-when-parallel-workflow-dsl): [99% verified] Shipped `when:` authority contradicts the APPROVED DSL decision: it accepts selected built-in lifecycle steps and rejects gating/structural custom steps, while the ADR makes `when:` custom-step-only and requires lifecycle-step rejection.
```
