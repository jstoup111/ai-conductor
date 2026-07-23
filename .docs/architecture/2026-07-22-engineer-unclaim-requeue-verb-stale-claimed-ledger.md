# Architecture: stale claim recovery (unclaim / requeue + claim-time auto-heal)

**Date:** 2026-07-22
**Feature:** engineer intake — recover stranded `claimed` entries
**Tier:** M

This is a bounded extension of the existing engineer intake machinery. New surfaces are
marked **(new)**; everything else already exists.

## Component view (C4 level 2/3)

```mermaid
flowchart TD
  OP([Operator]) -->|"engineer claim"| CLI[engineer-cli.ts<br/>subcommand dispatch]
  OP -->|"engineer unclaim &lt;ref&gt; (new)"| CLI
  OP -->|"engineer requeue --stale (new)"| CLI

  subgraph intake["engineer/intake"]
    QUEUE["queue.ts<br/>file-backed inbox<br/>claim / ack"]
    GUARD["delivery-guard.ts<br/>createDeliveryGuardedQueue<br/>claim-time heal pass"]
    LEDGER["ledger.ts<br/>Ledger: transition / reopen /<br/>requeueClaimed (new)"]
    REAP["stale-claim reaper (new)<br/>age &gt; staleness window?"]
  end

  GH[(GitHub issues<br/>via gh)]
  STORE[("~/.ai-conductor/engineer/<br/>ledger.json")]

  CLI -->|claim| GUARD
  GUARD -->|wraps| QUEUE
  GUARD -->|"heal delivered → done (existing)"| LEDGER
  GUARD -->|"reap stale claimed → pending (new)"| REAP
  REAP --> LEDGER

  CLI -->|"unclaim: claimed→pending (new)"| LEDGER
  CLI -->|"requeue --stale: bulk (new)"| REAP
  REAP -->|"liveness: issue closed? (new)"| GH
  REAP -->|"closed → forget / open → pending (new)"| LEDGER

  LEDGER <--> STORE
```

## Sequence — automatic reap at claim time (FR-2, FR-4, FR-12)

```mermaid
sequenceDiagram
  participant OP as Operator
  participant CLI as engineer claim
  participant GUARD as delivery-guard
  participant REAP as stale-claim reaper (new)
  participant LEDGER as Ledger
  OP->>CLI: engineer claim
  CLI->>GUARD: claim (guarded)
  GUARD->>GUARD: heal delivered entries → done (existing)
  GUARD->>REAP: scan claimed entries (new)
  REAP->>REAP: age = now − lastSeenAt > window?
  alt stale
    REAP->>LEDGER: requeueClaimed(ref) → pending, keep capturedAt (new)
    REAP-->>CLI: announce reaped ref (FR-12)
  end
  CLI->>GUARD: dequeue oldest pending (capturedAt order)
  GUARD-->>OP: claimed idea (or empty)
```

## Sequence — bulk manual requeue with liveness (FR-8, FR-9)

```mermaid
sequenceDiagram
  participant OP as Operator
  participant CLI as engineer requeue --stale (new)
  participant LEDGER as Ledger
  participant GH as GitHub (gh)
  OP->>CLI: engineer requeue --stale [--older-than D]
  CLI->>LEDGER: list claimed entries (optionally age > D)
  loop each stale claimed entry
    CLI->>GH: issue state for sourceRef
    alt issue closed
      CLI->>LEDGER: forget(ref)  %% #279 liveness
    else issue open / no ref
      CLI->>LEDGER: requeueClaimed(ref) → pending, keep capturedAt
    end
  end
  CLI-->>OP: summary (requeued N, forgotten M)
```

## Key structural points

- **Reaper is one heal rule, not a new subsystem.** Automatic recovery lives inside the
  existing `createDeliveryGuardedQueue` claim-time pass, which already heals *delivered*
  entries to `done`. The new rule reaps *stale `claimed`* entries to `pending`. Same
  invocation point, same guard object — no new call site in the claim path.
- **New ledger transition is distinct from `reopen`.** `reopen` is `done → pending` (spec-PR
  closed-unmerged, FR-39/40) and increments `attempts`. Stale-claim recovery is
  `claimed → pending`; it preserves `capturedAt` (FR-4) and its `attempts` semantics are an
  ADR question. Modeled as a dedicated `requeueClaimed` operation to keep the two lifecycles
  from entangling.
- **Shared reaper core for auto + manual.** The claim-time reaper and the bulk `requeue --stale`
  verb share one predicate (age past window) and one transition (`requeueClaimed`); the manual
  bulk path adds the GitHub liveness branch (closed → `forget`). The single-idea `unclaim`
  verb is the same transition with an operator-supplied ref and a refuse-on-terminal guard.
- **Staleness signal is `now − lastSeenAt`.** `lastSeenAt` is stamped when the entry became
  `claimed`; no heartbeat refreshes it, so this is an age-since-checkout signal. The window's
  default is an ADR question (Open Questions in the PRD).
