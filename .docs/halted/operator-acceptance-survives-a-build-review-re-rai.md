# Halt record

Status: halted
Slug: operator-acceptance-survives-a-build-review-re-rai
Class: needs-human
Halting step: build
Phase: BUILD
Branch: feat/daemon-operator-acceptance-survives-a-build-review-re-rai
Head SHA: b8f921cbe615612767efb1517f8646d8216b3b3d
Halted at: 2026-10-22T23:57:11.512Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
feature errored — will re-dispatch on the next scan
loop ended without DONE or HALT marker

Resume procedure:
  1. Fix the cause of the error above (project setup / config / environment / a crashed step).
  2. rm .pipeline/HALT
  3. Re-queue the feature (restart the daemon if it was excluded this run).
```
