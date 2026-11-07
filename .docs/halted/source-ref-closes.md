# Halt record

Status: halted
Slug: source-ref-closes
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-source-ref-closes
Head SHA: 9ab79eff0e2a3d25e94c0e2265eecf7e6c20a9a6
Halted at: 2026-11-07T21:03:22.957Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
feature errored — will re-dispatch on the next scan
done without a finish-choice marker (expected finishChoice: "pr")

Resume procedure:
  1. Fix the cause of the error above (project setup / config / environment / a crashed step).
  2. rm .pipeline/HALT
  3. Re-queue the feature (restart the daemon if it was excluded this run).
```
