# Halt record

Status: halted
Slug: bin-setup-re-runs-on-every-dispatch-instead-of-onc
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-bin-setup-re-runs-on-every-dispatch-instead-of-onc
Head SHA: 6cf2cfdcbb4b8ad47adf97c3802727a55af526b3
Halted at: 2026-08-28T07:57:54.052Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-1 (REMEDIABLE; adr-2026-08-26-setup-once-per-worktree-marker decision 1): `preparedAtCommit` duplicates `baseSha`, so the marker loses the distinct prepared-commit provenance required by the APPROVED ADR.
AB-2 (REMEDIABLE; adr-2026-08-26-setup-once-per-worktree-marker decision 4): Production forced triage omits `baseSha`, so a successful verification cannot rewrite the setup marker.
AB-3 (REMEDIABLE; adr-2026-08-26-setup-once-per-worktree-marker decision 3): Production forced triage omits the feature emitter, so the `forced` reason bypasses event persistence and rendering.
AB-4 (DESIGN; adr-2026-08-26-setup-once-per-worktree-marker decision 3): Task 13 ships a seventh reason and parallel raw skip line that the binding closed-union/event-spine decision does not permit.
```
