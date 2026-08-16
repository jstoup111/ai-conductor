---
title: Corrupt intake ledger
parent: Runbooks
nav_order: 7
---

# Corrupt intake ledger or stuck ledger lease

The engineer intake ledger (`<engineer dir>/ledger.json`) is the sole dedup authority for
intake ideas. A corrupt ledger **stops intake on purpose** — every mutating CLI verb exits
non-zero, the engineer launch pre-poll refuses to open a session, and the background intake
loop pauses — because proceeding without dedup would re-dispatch already-handled ideas.
This runbook covers the two operator-recovery cases that refusal creates
(design decision: `adr-2026-08-12-fail-closed-intake-ledger-durability`).

## Corrupt ledger

**Symptom.** A failing verb or paused loop prints a diagnostic that names both paths:

```text
corrupt ledger ledger=<engineer dir>/ledger.json quarantine=<engineer dir>/ledger.json.corrupt-<n>
```

The corrupt bytes have already been copied to the quarantine path; the live path is left in
place so the failure reproduces (and re-quarantines to the same sibling for identical bytes)
until an operator repairs it.

**Recovery.**

1. Inspect the quarantine file. Truncated or interleaved JSON usually means an interrupted
   write; recognizable entries mean the data is recoverable.
2. Repair `ledger.json`: either fix the JSON in place, or restore the newest parseable
   quarantine sibling over it. If nothing is recoverable, restore the file from git history
   or — as a last resort — start from `[]` and accept that dedup history is lost for
   entries not carrying the `engineer:handled` label on their GitHub issues.
3. Re-run the failing verb (or let the intake loop's next tick probe the ledger). A
   successful read is the only evidence the episode is over; the loop resumes by itself.

Quarantine siblings are never deleted automatically; remove them once the episode is
understood.

## Stuck ledger lease

**Symptom.** Every ledger operation — including read-only `list`/`get` — fails with a lease
acquire timeout naming `<ledger path>.lease`.

A lease whose owner process is dead is reclaimed automatically. The residual case is a
*live* process holding the lease indefinitely (a hung verb or loop).

**Recovery.**

1. Identify the holder from the owner pid recorded inside the lease directory and confirm
   it is genuinely hung (not mid-write).
2. Stop the holder.
3. If the lease directory survives its holder, remove that one enumerated path by hand:
   `rm -r <ledger path>.lease` — never a glob.
4. Re-run the failed operation.
