# Halt record

Status: halted
Slug: the-cumulative-kickback-cap-never-resets-so-a-reco
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-the-cumulative-kickback-cap-never-resets-so-a-reco
Head SHA: ddf4528460602f37360a12243d470cf47eafb569
Halted at: 2026-08-31T18:36:11.187Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED — shipped code violates an approved architecture decision

Blocking findings:
AB-1 (REMEDIABLE; Task 4): Existing rollback, rebase-credit, and growth-reconciliation paths still write the kickback ledger outside the new lease.
AB-2 (REMEDIABLE; Task 4): Rebase lap credit treats effectiveLimit as a counter and resets it to zero instead of preserving adjusted state.
AB-3 (REMEDIABLE; adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class decision 4): The shipped raise command accepts --amount instead of the carried-forward approved --by interface.
AB-4 (REMEDIABLE; Task 11): Mutation and resume do not bind ledger authorization to the originating gate of the live needs-human halt.
AB-5 (REMEDIABLE; Task 15): Reconciliation creates a missing authorization occurrence and applies a decision that was not durable before interruption.
AB-6 (REMEDIABLE; Task 15): Duplicate adjustment occurrences are not detected as ambiguous; only the first matching id is compared.
AB-7 (REMEDIABLE; Task 7): The external event append writes before release and ignores lease-ownership loss at release.
AB-8 (REMEDIABLE; Task 16): Resume consumes authorization before marker clearing and does not make halt-record resolution failure retain the halt.
AB-9 (REMEDIABLE; Task 18): The cap halt still uses an independent partial string instead of the canonical budget view.
AB-10 (REMEDIABLE; adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class decision 4): The external authorization event is configured for engine-ledger persistence after re-emission, violating the no-repersist contract.
AB-11 (REMEDIABLE; Task 6): The event is declared OTel-enabled, but the OTel dispatcher has no handling branch for it.
AB-12 (REMEDIABLE; Task 19): The external-event live tail exists only during build, so a legitimate later-step resume can bypass daemon, audit, and OTel consumers.
AB-13 (REMEDIABLE; Task 16): The authorization consumer runs only on base-SHA-advance sweeps; ordinary recovery releases its park but does not trigger that precondition.
AB-14 (DESIGN; Story 2 negative path 1): The approved plan makes malformed history invalidate the whole entry, preventing the sealed partial-trust inspection outcome.
```
