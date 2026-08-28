# Halt record

Status: halted
Slug: config-keys-that-validate-but-have-no-consumer-inc
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-config-keys-that-validate-but-have-no-consumer-inc
Head SHA: be864f54bd76c5cecdf4106195ae9491adfa8060
Halted at: 2026-08-28T14:26:13.977Z

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
