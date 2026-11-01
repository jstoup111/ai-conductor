# Architecture: Shared revalidation-queue admission for stacked child BUILD entry

**Last updated:** 2026-10-31
**Scope:** How a queued closed-child revalidation becomes an open `revalidate` round and a repair
marker before child BUILD-region entry. Covers the in-loop `rebase` restack path (#3477) and the
routed-exit fall-through path (#3473). Spec stem: `rebase-base-refresh-revalidation-halts-needs-human`.

## Components

```mermaid
graph LR
    subgraph Callers["Admission callers"]
        Preflight["Resume stack preflight<br/>restack/stack-preflight.ts"]
        RoutedExit["Routed-exit continuation<br/>conductor.ts"]
        RegionEntry["BUILD-region entry<br/>enterRoutedHostRegion, conductor.ts"]
    end

    subgraph Routing["routing/"]
        Helper["Shared queue admission helper<br/>queue-admission.ts"]
        Reconcile["reconcileRounds<br/>round-admission.ts"]
        Consume["consumeLowestQueued<br/>revalidation-queue.ts"]
        Fence["checkRoundAdmissionFence<br/>round-admission.ts (#3445)"]
        Stall["recordRoundStall<br/>bounded routing stall (#3445)"]
    end

    Refs[("refs/conductor/«slug»/<br/>revalidate · repairing · routes/r«n»")]
    Cursor["resolveActiveChild →<br/>resolveExecutionChild"]

    Preflight --> Helper
    RoutedExit --> Helper
    RegionEntry --> Helper
    Helper --> Reconcile
    Helper --> Consume
    Consume --> Fence
    Helper --> Stall
    Reconcile --> Refs
    Consume --> Refs
    RegionEntry --> Cursor
    Cursor --> Refs
```

## Sequence: in-loop BUILD-region entry with a queued revalidation

```mermaid
sequenceDiagram
    participant GateLoop as Gate loop
    participant Entry as BUILD-region entry
    participant Cursor as Execution-child resolver
    participant Helper as Shared queue admission helper
    participant Reconcile as reconcileRounds
    participant Consume as consumeLowestQueued
    participant Refs as Routing refs

    GateLoop->>Entry: region step for «slug» after rebase restack queued child j
    Entry->>Cursor: resolve execution child
    Cursor-->>Entry: source revalidating, child j, no repair marker
    Entry->>Helper: admit queued revalidation
    Helper->>Reconcile: reconcile open rounds first
    Reconcile->>Refs: read marker and route records
    alt reconcile result continues an open round
        Reconcile-->>Helper: navigate-host, navigate-leaf-to-build or resume-exit
        Helper-->>Entry: continuing round outcome
        Entry->>Cursor: re-resolve, the open round owns the host
    else reconcile result is none, aborted, deferred, leaf-returned or quiescent
        Reconcile-->>Helper: no round to continue
        Helper->>Consume: consume the queue head
        Consume->>Refs: fence check, create revalidate round r«n», write marker for host j and round r«n»
        alt admitted
            Consume-->>Helper: admitted r«n» host j
            Helper-->>Entry: admitted
            Entry->>Cursor: re-resolve
            Cursor-->>Entry: source routed-host, child j, round r«n»
            Entry->>GateLoop: enter child j region and dispatch
        else busy
            Consume-->>Helper: fence refused, names the blocking round
            Helper-->>Entry: busy
            Entry->>GateLoop: mechanical HALT naming queued child, open rounds, marker owner
        else stalled
            Consume-->>Helper: an unreadable round was found
            Helper->>Helper: re-reconcile, then record the bounded routing stall
            Helper-->>Entry: stalled
            Entry->>GateLoop: HALT through the bounded stall, mechanical then needs-human
        else unavailable
            Consume-->>Helper: queue or marker refs are unreadable
            Helper-->>Entry: unavailable
            Entry->>GateLoop: needs-human HALT naming queued child, open rounds, marker owner
        end
    end
```

## Legend

- **Shared queue admission helper.** This is the single reconcile→consume sequence. Today it is
  duplicated in resume preflight and the routed-exit continuation and missing at BUILD-region
  entry. Each caller keeps its own mapping from outcome to action. Preflight returns
  `navigate-host`, the routed exit returns the next region index, and region entry re-resolves
  and enters.
- **Region entry admits before refusing.** A `revalidating` execution child with no repair marker
  is no longer a terminal refusal. It is the signal to run admission. Region entry halts only when
  admission reports genuine unavailability or a fence or stall stop.
- **Nothing queued means unchanged behavior.** When a restack queues nothing, the cursor never
  resolves `revalidating`, the helper is not reached at region entry, and the loop proceeds to the
  whole-feature gates as today.
- **One admission per queue head.** The helper relies on `consumeLowestQueued`, which returns `busy`
  when a marker already exists or the #3445 fence refuses. A resume that follows an in-loop
  admission therefore continues the open round and never creates a duplicate `revalidate` round.
- Guillemets (`«slug»`, `r«n»`) mark variable parts of names.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-10-31 | Initial component and region-entry admission sequence. | Spec for #3477 with #3473 folded in: queued revalidations halt at child BUILD entry. |
