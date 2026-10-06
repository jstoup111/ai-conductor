# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-10-06T13:36:12.094Z
Slug: engine-prompts-direct-daemon-sessions-to-ai-conduc
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-engine-prompts-direct-daemon-sessions-to-ai-conduc
Head SHA: 952fe1212c88cd6bdcb8b1b0a82d93de6d65a658
Halted at: 2026-10-06T13:34:04.236Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
VERSION-bump approval mismatch (self-host version gate) — approved "1.5.0" but VERSION is "1.6.0". Reconcile the bump, then resume.

Harness self-build gate HALT — the daemon never merges (ADR-005/ADR-010).
Resume procedure:
  1. Address the gate reason above in this worktree and commit the fix.
  2. Clear .pipeline/HALT and .pipeline/HALT.class — the daemon re-dispatches the feature, re-runs the gates, and opens or updates the PR.
  3. Merge the PR yourself once its checks pass.
```
