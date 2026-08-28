# Halt record

Status: halted
Slug: every-project-reports-the-same-otel-identity-so-me
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-every-project-reports-the-same-otel-identity-so-me
Head SHA: 890ff9b736b4b2112eb9d382ff8dfa86d7508157
Halted at: 2026-08-28T10:57:20.702Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
feature errored — will re-dispatch on the next scan
Daemon base-state update failed (persistence): Unknown step: retro

Resume procedure:
  1. Fix the cause of the error above (project setup / config / environment / a crashed step).
  2. rm .pipeline/HALT
  3. Re-queue the feature (restart the daemon if it was excluded this run).
```
