# Components: Operator Inspection and Supersession of Routed Rounds (#3459)

**Last updated:** 2026-10-29
**Scope:** The new operator CLI family `ai-conductor stack rounds`. A read-only inspect form lists
every routed round, the repair marker and each receipt's settlement state. A guarded `--close` form
supersedes one stale open round through the existing routing compare-and-swap. Shown: the CLI
registration (`cli.ts`, `cli-pre-dispatch.ts`, `index.ts`), the new `stack-rounds-cli.ts`
dispatcher, the reused stack-land authority primitives, the routing store, and the event spine path
that carries the supersession occurrence.

## Diagram

```mermaid
graph TD
    OP["Operator terminal"]

    subgraph CLI["CLI registration"]
        DET["NEW: detectStackRoundsCommand<br/>cli.ts + cli-pre-dispatch.ts<br/>stack rounds --slug «slug»<br/>[--close «rN» --reason «text»]"]
        IDX["index.ts pre-dispatch<br/>beside stack land / stack owners"]
    end

    subgraph Dispatch["NEW: stack-rounds-cli.ts"]
        INS["Inspect (read-only)<br/>rounds, phase, kind, hosts,<br/>current host, receipt settled?,<br/>marker, wedge diagnosis"]
        CLS["Close (guarded write)<br/>refusal predicate, then one CAS"]
    end

    subgraph Authority["Reused stack-land authority"]
        ELIG["Routing on + durable child state<br/>(stack-land eligibility)"]
        LEASE["acquireFeatureDispatchLease<br/>feature-dispatch-lease.ts"]
        WHO["resolveMachineOperatorIdentity<br/>cli-operator-authority.ts"]
    end

    subgraph Routing["Routing store (unchanged shapes)"]
        READ["readRouteRecord / readRepairMarker<br/>route-record-store.ts"]
        TX["writeRoutingTransaction<br/>update-record CAS<br/>phase open → closed,<br/>pending hosts → done"]
        EVT["NEW: routingRoundSupersededEvent<br/>routing-events.ts<br/>withOutboxEvent"]
    end

    subgraph Spine["Event spine"]
        UNION["NEW variant routing_round_superseded<br/>ConductorEvent union (types/events.ts)"]
        DRAIN["drainRoutingOutboxes<br/>next engine resume"]
        LOG[".pipeline/events.jsonl<br/>EventPersister"]
    end

    REC["reconcileRounds (#3462 shape)<br/>walks remaining open round;<br/>its returnToLeaf re-pends leaf gates"]

    OP --> DET --> IDX
    IDX --> INS
    IDX --> CLS
    INS --> ELIG
    INS --> READ
    CLS --> ELIG
    CLS --> WHO
    CLS --> LEASE
    CLS --> READ
    CLS --> EVT --> TX
    EVT -. typed by .-> UNION
    TX --> DRAIN --> LOG
    TX -. superseded round closed;<br/>another round stays open .-> REC
```

## Legend

- **NEW** marks a component or variant this feature adds. Every other node already exists and keeps its
  shape. In particular, the `RouteRecord` schema, the repair-marker blob and the kickback ledger are unchanged.
- **Close refusal predicate:** routing disabled, or not a stacked feature; feature in flight (lease held);
  no approved operator identity; empty `--reason`; round absent, unreadable or not `open`; any host in
  `admitted`, `repairing`, `built`, `reroute-moved`, `abandoning` or `abandoned`; repair marker names this
  round; record carries an in-progress reroute; no *other* non-closed round exists, because closing the sole
  round would skip `returnToLeaf`.
- **Budget:** settled receipt charges stay in the ledger. An unsettled receipt was never charged
  (`settleRoundAtDispatch`), so supersession drops no charged budget.
- Solid arrows are calls. Dotted arrows are typing or downstream effect.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-29 | Initial generation | #3459 outcome 3: supported operator recovery for wedged routed rounds |
