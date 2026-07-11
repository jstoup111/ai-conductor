# Sequence: Priority-banded intake claim (#461)

**Last updated:** 2026-07-10
**Scope:** One `conduct-ts engineer claim` invocation with pending entries
{low(oldest), critical(newest)} — banded path and reader-outage fallback.

## Diagram

```mermaid
sequenceDiagram
    participant CLI as engineer claim
    participant W as claimUnblocked
    participant Q as guarded file queue
    participant B as resolveClaimBands
    participant GH as gh REST
    participant R as blocker resolver

    CLI->>W: claim request
    loop drain pending (oldest-first)
        W->>Q: claim()
        Q-->>W: envelope «low», envelope «critical», ... then null
    end
    W->>B: sourceRefs of all held envelopes
    B->>GH: issues/«N» per ref (labels)
    alt reader ok
        GH-->>B: labels
        B-->>W: band map (parsePriorityLabels)
        Note over W: sort critical → high → medium → low → unlabeled,<br/>receivedAt FIFO within band
    else reader throws (outage / quota)
        GH--xB: error
        B-->>W: fallback (no map), log once
        Note over W: keep held order — pure receivedAt FIFO
    end
    loop candidates in final order
        W->>R: resolve(sourceRef)
        R-->>W: verdict
        Note over W: first unblocked wins,<br/>blocked entries deferred (unchanged)
    end
    W->>Q: release every non-selected envelope
    W-->>CLI: claim = critical entry (banded)<br/>or oldest unblocked (fallback)
    CLI->>Q: ack(selected)
    CLI->>CLI: ledger transition to claimed
```

## Legend

- The drain loop and release-all-deferred behavior already exist for all-blocked
  detection — banding only changes the *order* candidates are offered to the blocker
  resolver, never queue mechanics or deferral semantics.
- Outage fallback is per-claim and logged exactly once per invocation; the next claim
  retries banding fresh (each claim is a new process — no cross-claim cache).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for issue #461 |
