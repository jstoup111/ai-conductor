# Halt record

Status: halted
Slug: coherence-artifact-passes-engineer-land-then-block
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-coherence-artifact-passes-engineer-land-then-block
Head SHA: a741fdb7c0b6dd30c4ea0d845cec971b5ab8d4a8
Halted at: 2026-08-28T01:26:46.639Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-3 (DESIGN; adr-2026-08-26-shared-coherence-parser-at-discovery decision 4): The committed corpus permits an old-predicate acceptance to become parser-rejected and dedup-skipped or visibly blocked, while the unsuperseded ADR requires every old-accepted fixture to remain eligible.
```
