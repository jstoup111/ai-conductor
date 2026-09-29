# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-09-29T13:17:45.547Z
Slug: make-bin-install-uninstall-remove-installer-settin
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-make-bin-install-uninstall-remove-installer-settin
Head SHA: cb55a995cf26047ca1c115347fd904478d2d2b2f
Halted at: 2026-09-29T12:46:35.666Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

````text
Migration block required (self-host release gate) — breaking surface(s): skill symlink targets, but CHANGELOG has no runnable ```bash migration``` block under a `## Migration` section for `bin/migrate`. Alternatively, commit a waiver at `.docs/release-waivers/<plan-stem>.md` (e.g. `.docs/release-waivers/self-host-release-gate-bin-conduct-breaking-surfac.md`) with a `Waives:` list of the exact breaking surface(s) and a rationale explaining why this is internal-only / no consumer-visible change.

Harness self-build gate HALT — the daemon never merges (ADR-005/ADR-010).
Resume procedure:
  1. Address the gate reason above in this worktree and commit the fix.
  2. Clear .pipeline/HALT and .pipeline/HALT.class — the daemon re-dispatches the feature, re-runs the gates, and opens or updates the PR.
  3. Merge the PR yourself once its checks pass.
````
