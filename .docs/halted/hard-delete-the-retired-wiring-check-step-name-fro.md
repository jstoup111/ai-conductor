# Halt record

Status: halted
Slug: hard-delete-the-retired-wiring-check-step-name-fro
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-hard-delete-the-retired-wiring-check-step-name-fro
Head SHA: ec855d345ca376c167fe69455216ca535bc88b28
Halted at: 2026-08-28T13:08:34.947Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-1 (DESIGN; adr-2026-08-11-deprecated-no-op-step-retirement decision): Hard deletion ships migration-only consumer-config compatibility even though the APPROVED retirement decision requires retaining the no-op until consumer config can no longer reference the name and explicitly rejects that compatibility shape.
```
