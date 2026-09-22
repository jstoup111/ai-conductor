# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-22T16:53:15.071Z
Slug: daemon-reclaim-sweep-deletes-a-worktree-that-holds
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-daemon-reclaim-sweep-deletes-a-worktree-that-holds
Head SHA: 9c7c0d1afa83395dce8d3835d64dff648778c0df
Halted at: 2026-09-22T13:30:37.107Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-2 (adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main D9)

Blocking findings:
AB-1 (REMEDIABLE; adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main D9): Every sweep candidate now depends on the shipped-record listing, contrary to the requirement that a non-daemon candidate never read or depend on it.
AB-2 (DESIGN; adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main D9): `no-merge-proof` is emitted as `worktree_reclaim_failed`, while D9 requires helper refusals to emit `worktree_reclaim_retained`; the sealed story requires the new behavior, so a human architectural decision is required.
```
