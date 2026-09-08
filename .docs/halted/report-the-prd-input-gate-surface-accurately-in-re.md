# Halt record

Status: halted
Slug: report-the-prd-input-gate-surface-accurately-in-re
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-report-the-prd-input-gate-surface-accurately-in-re
Head SHA: bb511761ea358c90f3f32f6d7c6017ed8d2f5ee2
Halted at: 2026-09-08T06:18:10.517Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-1 (adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback decision 2), AB-2 (adr-2026-08-31-coverage-binding-judge-step decision 4)

Blocking findings:
AB-1 (DESIGN; adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback decision 2): Production strips stories/specs paths before the new projection, so declared-document invalidation can never occur through a real rebase.
AB-2 (DESIGN; adr-2026-08-31-coverage-binding-judge-step decision 4): The projected `coverage_binding` surface omits its approved plan/coherence carrier and task `Done when` inputs.
```
