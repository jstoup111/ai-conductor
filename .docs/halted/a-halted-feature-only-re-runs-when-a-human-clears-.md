# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-07T15:44:09.622Z
Slug: a-halted-feature-only-re-runs-when-a-human-clears-
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-a-halted-feature-only-re-runs-when-a-human-clears-
Head SHA: de7300b87726021b30c84005fc15345caf96e9a0
Halted at: 2026-09-07T14:32:30.948Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): AB-1 (Story 3)

Blocking findings:
AB-1 (DESIGN; Story 3): The approved plan covers only base-advance retention, leaving progress re-kick and episode-end recovery able to violate the sealed all-automatic-path outcome.
AB-2 (REMEDIABLE; Task 14): `inspect` returns before command-entry reconciliation, so two sealed crash-recovery cases are not delivered.
AB-3 (REMEDIABLE; Task 15): `prd_audit` and as-built write `kickback-cap`, but the CLI accepts only `needs-human`, making both advertised recovery paths unreachable.
AB-4 (REMEDIABLE; Task 11): Production mutation bypasses the required machine user-config→GitHub identity chain, copies feature resolution locally, and leaves rationale unbounded.
AB-5 (REMEDIABLE; Task 17): The daemon boundary omits processed/live-halt verification and atomic presentation cleanup, and consumes authorization before a clear that cannot report partial.
AB-6 (REMEDIABLE; adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class D4): A remediation ledger read-modify-write computes outside the feature lease and can overwrite a concurrent adjustment.
AB-7 (REMEDIABLE; adr-2026-08-31-kickback-ledger-read-fails-closed decision 3): One malformed gate sets a ledger-global unreadable state that prevents healthy sibling-gate operations.
```
