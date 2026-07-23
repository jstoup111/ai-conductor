# Sequence: claim-time closed-issue guard + brain sweep

**Last updated:** 2026-07-22
**Scope:** How a closed GitHub issue is prevented from being handed to an operator at
`engineer claim`, and how the brain sweep cleans stale closed entries between claims.

## Diagram

```mermaid
sequenceDiagram
  actor Op as Operator
  participant Claim as engineer claim
  participant Guard as DeliveryGuardedQueue
  participant Sel as claimUnblocked
  participant Inbox as inbox/*.json
  participant Ledger as ledger.json
  participant GH as GitHub (getIssueState)

  Note over Op,GH: Case 1 — guard at dequeue (synchronous safety net)
  Op->>Claim: conduct-ts engineer claim
  Claim->>Guard: claim next unblocked
  Guard->>Sel: select oldest unblocked candidate
  Sel->>Inbox: claim() envelope
  Inbox-->>Sel: envelope (github-issues, «ref»)
  Sel-->>Guard: candidate envelope
  Guard->>GH: getIssueState(«ref»)
  alt issue CLOSED
    GH-->>Guard: closed
    Guard->>Ledger: forget(«ref»)
    Guard->>Inbox: drop envelope
    Guard->>Sel: skip, request next candidate
    Note right of Guard: repeat until an OPEN<br/>candidate or queue drains
  else issue OPEN or state unknown (null)
    GH-->>Guard: open / null
    Note right of Guard: null fails safe —<br/>treat as open, do not drop
    Guard-->>Claim: deliver envelope
    Claim->>Inbox: ack
    Claim->>Ledger: transition claimed
    Claim-->>Op: routed idea «ref»
  end

  Note over Op,GH: Case 2 — brain sweep (periodic janitor)
  loop every intake tick (brain loop)
    participant Sweep as brain sweep
    Sweep->>Ledger: load pending entries
    Sweep->>GH: getIssueState(«ref») per entry
    alt issue CLOSED
      GH-->>Sweep: closed
      Sweep->>Ledger: forget(«ref»)
      Sweep->>Inbox: drop matching envelope
    else open / null
      GH-->>Sweep: open / null
      Note right of Sweep: leave untouched<br/>(fail safe on null)
    end
  end
```

## Legend

- **Case 1** is the synchronous guard inside `createDeliveryGuardedQueue`: it never hands a
  closed issue to the operator, and continues to the next unblocked candidate instead of
  failing the whole claim.
- **Case 2** is the new periodic sweep in the brain intake-loop tick: it keeps the ledger +
  inbox from accumulating entries for issues closed since capture, even when no claim runs.
- **Fail-safe rule:** an unknown state (`null`, e.g. a transient `gh` failure) is treated as
  still-open — never drop an issue we cannot confirm is closed.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | New claim guard + brain sweep flows (spec DECIDE, tier M) |
