# Components: engineer intake subsystem — closed-issue guard + brain sweep

**Last updated:** 2026-07-22
**Scope:** The engineer intake path (poll → durable inbox + ledger → claim) and the two
new closed-issue control points. Scoped to the intake subsystem only, not the whole harness.

## Diagram

```mermaid
graph TD
  gh[("GitHub Issues<br/>(external)")]

  subgraph brain["Brain (host-wide singleton loop)"]
    poll["github-issues poll adapter<br/>github-issues.ts<br/>gh issue list --state open"]
    sweep["Brain reconciliation sweep<br/>(NEW) intake-loop.ts intakeTick<br/>modeled on halt-issues/sweep.ts"]
  end

  subgraph stores["Durable intake stores («engineerDir»)"]
    inbox[("Inbox queue<br/>inbox/*.json<br/>queue.ts")]
    ledger[("Ledger<br/>ledger.json<br/>ledger.ts")]
  end

  subgraph claim["Interactive engineer claim path"]
    claimcmd["engineer claim<br/>engineer-cli.ts"]
    guard["Delivery-guarded queue<br/>createDeliveryGuardedQueue<br/>delivery-guard.ts<br/>(NEW: issue-state probe)"]
    select["claimUnblocked<br/>dependency-claim.ts"]
  end

  gh -->|"open issues only<br/>(ingestion filter)"| poll
  poll -->|"record pending"| ledger
  poll -->|"enqueue envelope"| inbox

  sweep -.->|"getIssueState<br/>(open/closed/null)"| gh
  sweep -->|"CLOSED → forget entry"| ledger
  sweep -->|"CLOSED → drop envelope"| inbox

  claimcmd --> guard
  guard --> select
  select -->|"claim() oldest unblocked"| inbox
  guard -.->|"NEW: getIssueState<br/>on github-issues envelope"| gh
  guard -->|"CLOSED → forget + skip,<br/>try next candidate"| ledger
  guard -->|"CLOSED → drop envelope"| inbox
  guard -->|"OPEN → ack + transition claimed"| claimcmd

  classDef new fill:#d5f5e3,stroke:#1e8449,stroke-width:2px;
  classDef store fill:#fdebd0,stroke:#b9770e;
  classDef ext fill:#eaecee,stroke:#566573;
  class sweep,guard new;
  class inbox,ledger store;
  class gh ext;
```

## Legend

- **Green nodes** — new/changed behavior introduced by this feature: the issue-state probe
  inside `createDeliveryGuardedQueue`, and the new brain reconciliation sweep.
- **Orange nodes** — the two durable stores under `«engineerDir»` (default
  `~/.ai-conductor/engineer`): the inbox queue directory and `ledger.json`.
- **Solid arrows** — writes/reads to the durable stores or command flow.
- **Dotted arrows** — live GitHub reads (`GhAbstraction.getIssueState`).
- **`--state open`** on the poll adapter gates **ingestion only** — a closed issue is never
  newly captured, but this does nothing for an issue captured while open and closed later.
  The two green control points close that gap: the guard cleans/skips **at dequeue**, the
  sweep cleans **periodically**.
- **Disposition = forget:** a closed pending entry is removed (`ledger.forget`) and its inbox
  envelope dropped; a later reopen is re-ingested fresh by the `--state open` poll.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-22 | Initial generation | Added intake closed-issue guard + brain sweep (spec DECIDE, tier M) |
