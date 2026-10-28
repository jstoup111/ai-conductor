# Sequence + Components: Carry a routed fix up the stack and re-validate the children above (#3212)

**Last updated:** 2026-10-23
**Scope:** Spec D, the last of the four specs `adr-2026-10-12-routed-whole-feature-repair` is split
into (decision 18). It covers how a routed repair ends:
- the host leaves through one journaled exit restack, or through a no-commit compare-and-swap;
- the round moves on to the next host;
- every closed child a restack moved is re-validated, bottom-up, through a durable queue;
- the worktree returns to the leaf, and the leaf's whole-feature gates re-run.

It then turns `stacked_prs.route_whole_feature_fixes` on by default.

The whole design is drawn in
[`whole-feature-audit-fixes-cannot-land-in-the-stack.md`](whole-feature-audit-fixes-cannot-land-in-the-stack.md).
Admission (spec B) is in
[`admitted-whole-feature-fixes-in-a-stacked-feature-.md`](admitted-whole-feature-fixes-in-a-stacked-feature-.md),
and the routed-repair pass (spec C) in
[`a-routed-fix-cannot-be-built-charged-and-reviewed-.md`](a-routed-fix-cannot-be-built-charged-and-reviewed-.md).
These diagrams show only what this spec builds.

Covered:
- **Decision 13:**
  - the exit restack with routed lines in the `applied` transaction;
  - the restack's own exemption from the route-record writer fence;
  - marker deletion;
  - co-origins;
  - the cascade-cap halt that keeps the marker;
  - the preflight's `built` arm;
  - `hostNoOpEvidence` and the no-commit exit;
  - host progression;
  - the published-stack refusal.
- **Decision 9:** the replay union of appended rem blocks.
- **Decision 14:**
  - queue production on every restack cause, including recovery;
  - the gate-input-identity skip;
  - bottom-up `revalidate` rounds with their restage arm, verify-green pass, review bases and credit;
  - acknowledgement and its guards;
  - failure handled through the child's own exit.
- **Decision 15:** leaf parking, the recorded leaf return, and leaf gates re-pended under their existing caps.
- **Decision 16:** the queue outbox and its drain.

**Built on shipped code:**
- **The route-record store and its writer:**
  - `writeRoutingTransaction`
  - `transitionHost`
  - `drainOutbox` and `drainRoutingOutboxes`
  - `nextRoundId`
- **Reconciliation and region entry:**
  - `reconcileRounds`
  - `enterHostRegion` and the host `entry` baseline
- **The queue's existing pieces:**
  - the `revalidate` ref
  - `RevalidationQueueRecord`
  - the `child_revalidated` event
- **Cursor and execution child:**
  - the cursor's `revalidating` and `coOrigins` fields
  - `resolveExecutionChild`
- **Restack and publication:**
  - the restack executor, recovery and the preflight
  - `publishedStackRefusal`

**Not covered:** the PR comment on a published child, and refreshing a published stack. Both stay
with #3269 and #3268. The publication ADR (decision 11) freezes a published stack, so every routed
path here refuses on it.

With the setting off, or when the cursor reports `no-child`, every path below reduces to today's
leaf remediation, byte for byte.

## Diagram: routed exit restack

```mermaid
sequenceDiagram
    participant L as Loop region exit
    participant X as routed-exit.ts
    participant S as route-record store
    participant P as stack-publication
    participant R as restack executor
    participant G as git refs
    L->>X: host «h» region passed
    X->>G: compare host tip with closed/c«h»
    alt tip equals closure
        X->>S: one CAS, host repairing to done, delete marker, ack own queue entry, outbox phase
    else tip moved
        X->>S: CAS host repairing to built with outbox phase
        X->>S: drain route-record and queue outboxes
        X->>P: publishedStackRefusal
        alt published
            P-->>X: refuse
            X->>G: HALT needs-human published-stack
        else not published
            X->>R: runRestack feature-repair, origins host plus co-origins, routed context
            R->>R: check origins, halt on a foreign Round stamp
            R->>R: cascade cap check, halt keeps the marker
            R->>G: create journal carrying route, marker and queue old values
            R->>G: moved, branches and closed/c«k» refs
            R->>G: synced
            R->>R: applyRestackTransition computes the invalidation set
            R->>G: CAS journal records the invalidation set
            R->>G: applied transaction, cascades, delete marker, host restacked, next queue generation
        end
    end
```

## Diagram: crash recovery on the exit path

```mermaid
flowchart TD
    A["preflight, after journal recovery and live-HALT check"] --> B{"journal at synced?"}
    B -- yes --> C["recovery applies the same appliedTransactionLines"]
    B -- no --> D{"marker host built and no journal?"}
    D -- yes --> E{"live HALT from a rolled-back exit?"}
    E -- yes --> F["return halted, no restack"]
    E -- no --> G["requestRoutedExit skips the built CAS"]
    D -- no --> H{"marker set?"}
    H -- yes --> I["no automatic feature-repair restack"]
    H -- no --> J["today's automatic repair, now writing the queue"]
    J --> N{"follow-on base refresh and queue has entries?"}
    N -- yes --> O["suppress follow-on, emit deferred-base-refresh, keep or re-arm REKICK"]
    N -- no --> M
    C --> K{"applied CAS failed on a routed or queue ref?"}
    K -- yes --> L["HALT needs-human naming the ref"]
    K -- no --> M["reconcileRounds follows the return order"]
    M --> P{"no marker, no pending child host, queue has entries?"}
    P -- yes --> Q["consume lowest queued child before any region entry"]
```

## Diagram: re-validation queue

```mermaid
sequenceDiagram
    participant R as any restack applied
    participant Q as revalidate queue ref
    participant C as cursor and selector
    participant H as host region entry
    participant X as routed-exit.ts
    R->>Q: merge produced entries, one per child, newest closure SHA and replay tuple, union of gates, order by position
    Note over R,Q: a missing or stale verdict counts as invalidated, replay proof normalises inherited rem blocks
    C->>Q: lowest queued child «j»
    C->>H: revalidate round, nextRoundId, marker host «j» before any mutation
    H->>H: restage only the entry's gates, no lap, no growth, grant routed-repair credit
    H->>H: verify-green acceptance against the retained RED proof
    alt PASS with tip equal to closure
        X->>Q: one CAS, ack by generation, closure SHA and input identity, close round, delete marker, outbox child_revalidated
    else fix committed
        X->>R: exit restack originating at «j», applied acks the entry
    else caps exhausted
        X->>X: HALT needs-human naming «j»
    end
```

## Diagram: return order after a host settles

```mermaid
flowchart TD
    A["host restacked, done or rerouted"] --> B{"next pending child host?"}
    B -- yes --> C["advance currentHostIndex, admit host"]
    B -- no --> D{"queue has entries?"}
    D -- yes --> F["round stays open if a leaf host is pending, consume lowest queued child as a revalidate round"]
    D -- no --> G{"leaf host pending?"}
    G -- yes --> H["admit leaf host, its exit is one CAS, no restack"]
    G -- no --> L{"every host settled, another round open?"}
    L -- yes --> E["round closed in the same CAS"]
    L -- no --> I["returnToLeaf, switch to leaf if needed, record leafReturn"]
    I --> J["round closed"] --> K["re-pend leaf whole-feature gates, ledger unchanged"]
```

## Diagram: host and round phases written by this spec

```mermaid
stateDiagram-v2
    [*] --> repairing: enterHostRegion (spec C)
    repairing --> built: requestRoutedExit
    repairing --> done: no-commit exit or leaf host exit
    built --> restacked: exit restack applied
    restacked --> [*]
    done --> [*]
    state round {
        open --> closed: last host restacked, done or rerouted
    }
```

## Diagram: components touched

```mermaid
flowchart LR
    subgraph routing["engine/routing"]
        RX["routed-exit.ts (new)"]
        RQ["revalidation-queue.ts (new)"]
        RB["rem-block-merge.ts (new)"]
        RT["route-types.ts: queue entry fields, leafReturn"]
        RS["route-record-store.ts: delete-marker, queue ops, journal-owner exemption, queue drain"]
        RA["round-admission.ts: built, done, restacked, rerouted arms"]
        HRE["host-region-entry.ts: revalidate arm"]
        EV["routing-events.ts: childRevalidatedEvent"]
    end
    subgraph restack["engine/restack"]
        EX["restack-executor.ts: routed option, appliedTransactionLines"]
        REC["restack-recovery.ts"]
        JR["restack-journal.ts: routed, invalidation"]
        TR["restack-transition.ts: invalidation set"]
        RP["restack-replay.ts / restack-ownership.ts"]
        PF["stack-preflight.ts: built arm"]
    end
    subgraph engine["engine"]
        CON["conductor.ts"]
        SEL["selector.ts: routedParking"]
        BRI["build-review-inputs.ts / child-cursor.ts: revalidation bases"]
        CFG["config.ts: default on"]
        PUB["stack-publication.ts"]
    end
    CON --> RX
    CON --> SEL
    CON --> RQ
    RX --> RS
    RX --> EX
    RX --> PUB
    RX --> EV
    PF --> RX
    EX --> JR
    EX --> TR
    EX --> RQ
    EX --> RS
    REC --> EX
    TR --> RQ
    RP --> RB
    RQ --> RS
    RQ --> HRE
    RA --> RX
    BRI --> RT
```

## Legend

- **host «h» / child «j»**: a closed child of the stack at position h or j. The leaf is the last host.
- **closure**: `refs/conductor/«slug»/closed/c«k»`.
- **queue**: `refs/conductor/«slug»/revalidate`, a blob holding the generation, the entries and an
  outbox.
- **appliedTransactionLines**: the single builder of the restack's `applied` `update-ref --stdin`
  lines. The normal path, base refresh and recovery's `synced`→`applied` all use it.
- **journal-owner exemption**: the route-record fence lets the restack whose journal is open write
  routing refs. Every other writer is still refused.
- HALT outcomes are needs-human unless labelled otherwise.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-23 | Initial generation | Spec D DECIDE (#3212), re-derived from current code |
| 2026-10-23 | Return order keeps an audit round open until its leaf host settles; queue merge unions gates; standalone queue consumption and follow-on base-refresh deferral in recovery | Codex review folded into the architecture review (C8, C4, C12, C13) |
| 2026-10-23 | Recovery re-arms REKICK when it defers a follow-on base refresh | Operator decision at /plan (C13) |
