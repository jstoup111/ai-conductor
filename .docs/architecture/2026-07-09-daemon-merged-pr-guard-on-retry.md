# Components: Daemon merged-PR guard on step retry (#358)

**Last updated:** 2026-07-09
**Scope:** The mid-run merged-PR guard — where it hooks into the conductor's kickback rewind
and rebase step, and the ship side-effects it triggers on a MERGED verdict.

## Diagram

```mermaid
graph TD
    subgraph Conductor engine
        LOOP[Step loop<br/>conductor.ts run]
        KICK[Kickback rewind<br/>navigateBack to build<br/>manual_test / build_review / prd_audit / finish routes]
        REBASE[runRebaseStep]
        GUARD[MergedPrGuard<br/>NEW shared check]
        SHIP[Clean already-shipped stop<br/>NEW exit path]
    end

    subgraph Existing helpers
        PMS[prMergeState<br/>pr-labels.ts]
        WSR[writeShippedRecord<br/>shipped-record.ts]
        MP[markProcessed<br/>daemon-deps.ts]
    end

    GH[gh CLI<br/>pr view via GhRunner]
    LEDGER[(.daemon/processed/«slug»)]
    SREC[(.docs/shipped/«slug».md)]
    STATE[(.pipeline state<br/>pr_url)]

    REKICK[Daemon rekick play-forward<br/>resumeRebaseFirst]

    LOOP --> KICK
    LOOP --> REBASE
    KICK -- before re-dispatching build --> GUARD
    REBASE -- before performRebase --> GUARD
    REKICK -- before direct performRebase --> GUARD
    GUARD -- reads pr_url --> STATE
    GUARD --> PMS
    PMS --> GH
    GUARD -- MERGED --> SHIP
    GUARD -- OPEN / CLOSED / NOTFOUND / UNKNOWN / gh error --> LOOP
    SHIP --> WSR
    SHIP --> MP
    WSR --> SREC
    MP --> LEDGER
```

## Legend

- **NEW** nodes are introduced by this feature; everything else exists today.
- `MergedPrGuard` is advisory on every verdict except `MERGED` — a gh failure or a
  non-merged state lets the normal retry/rebase proceed unchanged (fail-open on the
  guard, never a new HALT source).
- On `MERGED` the run stops cleanly: shipped record + processed marker written, no
  rebuild, no rebase, branch left reachable.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-09 | Initial generation | DECIDE phase for issue #358 |
| 2026-07-09 | Added rekick play-forward as third guard call site | Conflict-check found the resumeRebaseFirst blind spot; operator approved scope extension |
