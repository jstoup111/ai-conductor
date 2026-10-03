# Sequence: Lease-guarded intake claim after an interrupted claim (#2733)

**Last updated:** 2026-10-02
**Scope:** Claim A is killed mid-walk; claim B later recovers A's stranded batch, while a
concurrent claim C waits for B's lease.

## Diagram

```mermaid
sequenceDiagram
    participant A as claim A
    participant B as claim B
    participant C as claim C
    participant LS as claim lease
    participant Q as file queue
    participant LG as ledger

    A->>LS: acquire
    LS-->>A: owner pid A
    A->>Q: drain pending (rename .json to .claimed)
    Note over A: killed during band / dependency reads
    Note over Q: batch left .claimed, ledger still pending

    B->>LS: acquire
    LS-->>B: owner pid A dead, recovered, owner pid B
    C->>LS: acquire
    Note over C: waits (bounded) while B holds the lease
    B->>Q: list .claimed envelopes
    B->>LG: statuses for their sourceRefs
    LG-->>B: pending
    B->>Q: release each orphan (.claimed to .json)
    B->>Q: claimUnblocked walk (banded, unchanged)
    Q-->>B: winner, non-selected released
    B->>Q: ack winner
    B->>LG: transition winner to claimed
    B->>LS: release
    LS-->>C: owner pid C
    Note over C: reconcile finds no orphans,<br/>walk claims a different entry
    C->>LS: release
```

## Legend

- Reconciliation runs only while the lease is held, so it can never touch a live walk's held
  envelopes (no double handout, compare #862).
- Strands created before this ships are recovered the same way on the first claim after upgrade.
- If C's bounded wait expires, C fails with a clear "claim in progress" error rather than racing.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-02 | Initial generation | DECIDE phase for issue #2733 |
