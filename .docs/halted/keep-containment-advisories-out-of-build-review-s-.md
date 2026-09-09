# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-09-07T22:12:34.767Z
Slug: keep-containment-advisories-out-of-build-review-s-
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-keep-containment-advisories-out-of-build-review-s-
Head SHA: 69e6ba70ab90f67513e86157e1dbb3ab63100a69
Halted at: 2026-09-07T22:00:08.111Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
VERSION-bump approval required (self-host version gate) — version_freeze is "1.1.0" but VERSION is "1.0.0"; a freeze never approves a bump. Record the approved bump in .pipeline/version-approval (or update the freeze), then resume.

Harness self-build gate HALT — the daemon never merges (ADR-005/ADR-010).
Resume procedure:
  1. Address the gate reason above.
  2. Re-install the harness (bin/install --update) and run /verify.
  3. rm .pipeline/HALT, then merge the PR yourself.
```
