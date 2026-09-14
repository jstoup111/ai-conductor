# Halt record

Status: halted
Slug: page-background-intake-past-github-default-30-issu
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-page-background-intake-past-github-default-30-issu
Head SHA: 1138fd0f1b23b1c864c01a9e12b7341b6fa10dff
Halted at: 2026-09-14T11:28:50.138Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Self-host release gate HALT: retained draft PR has absent or malformed release disposition (Error: Invalid release disposition: Migration).

Harness self-build gate HALT — the daemon never merges (ADR-005/ADR-010).
Resume procedure:
  1. Address the gate reason above.
  2. Re-install the harness (bin/install --update) and run /verify.
  3. rm .pipeline/HALT, then merge the PR yourself.
```
