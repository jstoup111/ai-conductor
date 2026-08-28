---
title: Runbooks
nav_order: 6
has_children: true
---

# Runbooks

Operational recovery procedures for daemon, worktree, and shipped-record incidents.

| Runbook | When to use it |
| --- | --- |
| [Daemon recovery](daemon-recovery.md) | The daemon will not start or stop, holds a stale lock, spins on the same failure, or runs a stale engine. |
| [Emergency stop a running feature](emergency-stop-a-running-feature.md) | Work is in flight and must be halted before you touch its git state. |
| [Stalled or stuck feature](stalled-or-stuck-feature.md) | A feature is dispatched but not progressing: no-task-progress stalls, build-progress ceilings, rate-limit waits, auth parks, kickback loops. |
| [Worktree and evidence recovery](worktree-and-evidence-recovery.md) | `.worktrees/<slug>` was removed, moved, or lost and its run state must be rebuilt from the branch. |
| [Shipped record reconciliation](shipped-record-reconciliation.md) | A feature shipped by hand and the daemon keeps re-dispatching it because `.docs/shipped/<slug>.md` is missing. |
| [Corrupt intake ledger](corrupt-intake-ledger.md) | Intake has stopped: the ledger is corrupt or its lease is stuck, and every mutating verb exits non-zero. |
| [Protected-artifact plan deadlock](protected-artifact-plan-deadlock.md) | `build_review` demands an outcome that would amend another feature's sealed DECIDE artifact, so no legal BUILD remediation exists. |
| [Abandoning a spec](abandoning-a-spec.md) | The operator has decided a spec will not be delivered and its DECIDE artifacts must leave the active backlog. |
