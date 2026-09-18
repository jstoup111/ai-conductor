# Halt record

Status: halted
Slug: reclaim-merged-feature-worktrees-without-depending
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-reclaim-merged-feature-worktrees-without-depending
Head SHA: 58cd505382517dcc815d125e120bf2f75ba1b33f
Halted at: 2026-09-18T12:54:31.577Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-1 (adr-2026-08-01-multi-proof-park-deletion-authority decision 1), AB-5 (Task 8)

Blocking findings:
AB-1 (DESIGN; adr-2026-08-01-multi-proof-park-deletion-authority decision 1): The helper and public event schema label `shipped-record` as a third deletion proof although the APPROVED proof set is exactly ancestry and merged-PR head identity.
AB-2 (REMEDIABLE; adr-2026-08-01-multi-proof-park-deletion-authority decision 7): A candidate that is both parked and registered discards the branch supplied by the worktree listing before the helper re-proves deletion safety.
AB-3 (REMEDIABLE; adr-2026-08-01-multi-proof-park-deletion-authority decision 8): Dropping the listed branch makes the shipped-record rule depend on parked state, so parked non-daemon branches are record-gated contrary to the branch-kind rule.
AB-4 (REMEDIABLE; Task 8): Parked candidates retained as orphan, normal, unclassified, or by disabled auto-cleanup can complete without the required terminal retained event.
AB-5 (DESIGN; Task 8): A parked-only successful reclaim emits an empty branch because the approved design requires a branch-bearing event while preserving an absent-branch helper contract.
```
