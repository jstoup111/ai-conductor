# Halt record

Status: halted
Slug: block-bare-force-pushes-inside-compound-commands
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-block-bare-force-pushes-inside-compound-commands
Head SHA: 04e19d518fd94ac7b655f76bea52f93a8878d269
Halted at: 2026-09-05T21:22:02.335Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

````text
Migration block required (self-host release gate) — breaking surface(s): hook wiring, but CHANGELOG has no runnable ```bash migration``` block under a `## Migration` section for `bin/migrate`. Alternatively, commit a waiver at `.docs/release-waivers/<plan-stem>.md` (e.g. `.docs/release-waivers/self-host-release-gate-bin-conduct-breaking-surfac.md`) with a `Waives:` list of the exact breaking surface(s) and a rationale explaining why this is internal-only / no consumer-visible change.

Harness self-build gate HALT — the daemon never merges (ADR-005/ADR-010).
Resume procedure:
  1. Address the gate reason above.
  2. Re-install the harness (bin/install --update) and run /verify.
  3. rm .pipeline/HALT, then merge the PR yourself.
````
