# Halt record

Status: resolved
Resolution cause: operator
Resolved at: 2026-11-10T14:09:26.739Z
Slug: manual-test-prompt-omits-the-pipeline-directory-at
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-manual-test-prompt-omits-the-pipeline-directory-at
Head SHA: 0c5a952eb0aef0a3c95e1725d4e687fee571533c
Halted at: 2026-11-09T17:02:15.488Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — Blocking findings: as-built:0d903f45-db80-49e0-86b0-b5d83b52b784:1 (DESIGN; adr-2026-11-07-external-boundary-ports-registry-and-ratchet decision 4): Verified, 99% confidence: D4 requires a shrink-only boundary allowlist. This feature introduces an execa import at src/conductor/src/engine/manual-test-record-cli.ts:8 and Git spawn at :102, then adds git/process exemptions at src/conductor/test/structural/boundary-allowlist.txt:233 and :234. These additions also contradict the approved boundary diagram's shrink-only rule. The plan explicitly prescribes this production runner, so reconciling that design with the governing ADR requires a design decision.

Blocking findings:
as-built:0d903f45-db80-49e0-86b0-b5d83b52b784:1 (DESIGN; adr-2026-11-07-external-boundary-ports-registry-and-ratchet decision 4): Verified, 99% confidence: D4 requires a shrink-only boundary allowlist. This feature introduces an execa import at src/conductor/src/engine/manual-test-record-cli.ts:8 and Git spawn at :102, then adds git/process exemptions at src/conductor/test/structural/boundary-allowlist.txt:233 and :234. These additions also contradict the approved boundary diagram's shrink-only rule. The plan explicitly prescribes this production runner, so reconciling that design with the governing ADR requires a design decision.
```
