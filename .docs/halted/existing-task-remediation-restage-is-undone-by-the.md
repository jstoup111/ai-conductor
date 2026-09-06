# Halt record

Status: halted
Slug: existing-task-remediation-restage-is-undone-by-the
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-existing-task-remediation-restage-is-undone-by-the
Head SHA: 5b94e390065e81279498ac41cffb9c1f81a702d3
Halted at: 2026-09-06T17:52:59.067Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-1 (DESIGN; adr-2026-09-06-reopened-task-resolution D1): The shipped main-root count-watermark sidecar conflicts with the approved engine-state repair-obligation architecture already present in the implementation base.
AB-2 (DESIGN; Task 9): Without `activePlanPath`, the fold never reads the recorded watermark, so the D1 guard can still treat the restaged task as resolved and refuse BUILD.
AB-3 (DESIGN; adr-2026-09-06-reopened-task-resolution D2): The sealed Story 6 post-restage baseline contract conflicts with the approved pre-reopen baseline and is not delivered by current source.
AB-4 (REMEDIABLE; Task 7): `resetRestageWatermarkDiagnostics` is a production export reachable only from tests.
```
