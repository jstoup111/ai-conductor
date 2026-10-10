# Components: Backend-Neutral Backlog Ordering Reads (#851)

**Last updated:** 2026-10-10
**Scope:** Target-state component view of the backend-neutral ordering port. The daemon, intake claim, the monitor queue,
the overlap scan, and the land-time coherence check read priority, size, and dependency facts through
this port. The diagram covers the new port, its GitHub implementation, the per-reference backend
dispatch, and the six rewired consumers. Jira reads (#849), intake filing and backfill (#850), and
write-backs (#852, #853) are out of scope. Paths are relative to `src/conductor/src/`.

## Diagram

```mermaid
graph TD
    subgraph Consumers["Consumers (rewired; behavior unchanged for GitHub refs)"]
        DPR["daemon-cli.ts<br/>createPriorityResolver (daemon backlog order)"]
        DBR["daemon-cli.ts<br/>makeResolver: createBlockerResolver"]
        DOR["engine/daemon-ordering-readers.ts (new)<br/>one OrderingSource per daemon run"]
        CLAIM["engine/engineer-cli.ts<br/>compose claim: resolveClaimBands + blocker resolver"]
        OVL["index.ts<br/>overlap-scan blocker resolver"]
        COH["engine/engineer/coherence-validator.ts<br/>advisory overlap blocker resolver"]
        MON["engine/monitor-cli.ts<br/>guided monitor queue priority resolver"]
    end

    subgraph Policy["Backend-agnostic ordering policy (logic unchanged)"]
        PRIO["engine/backlog-priority.ts<br/>createPriorityResolver: cache, outage fallback<br/>orderBacklog, PRIORITY_BAND_RANK"]
        BLK["engine/blocker-resolver.ts<br/>per-walk memo, cycle detection<br/>BlockerVerdict union"]
        BANDS["engine/engineer/intake/dependency-claim.ts<br/>resolveClaimBands"]
    end

    subgraph Port["NEW: backend-neutral ordering port"]
        OS["engine/ordering-source.ts<br/>OrderingSource<br/>readFacts(refs): priority band, size,<br/>or not-found / unavailable<br/>readBlockers(ref): canonical refs,<br/>or not-found / unavailable"]
        DISP["createOrderingSource(deps)<br/>dispatch per reference via parseWorkRef"]
    end

    subgraph Backends["Per-backend implementations"]
        GHO["GitHub ordering source<br/>wraps today's label parsing<br/>(parsePriorityLabels, parseSizeLabel)<br/>and the blocked_by read"]
        JIRA["Jira ordering source<br/>(#849, deferred)"]
        UNAV["unavailable result<br/>+ tracker_backend_unavailable<br/>reason no-adapter"]
    end

    subgraph Transport["Existing tracker seam (unchanged)"]
        TC["engine/tracker-client.ts<br/>runTrackerRepositoryRead, GhRunner"]
    end

    subgraph Spine["Event spine (unchanged schema)"]
        EV["ConductorEventEmitter → events.jsonl"]
    end

    DPR --> DOR
    DBR --> DOR
    DOR --> PRIO
    DOR --> BLK
    MON --> PRIO
    CLAIM --> BANDS
    CLAIM --> BLK
    OVL --> BLK
    COH --> BLK
    PRIO --> OS
    BANDS --> OS
    BLK --> OS
    OS --> DISP
    DISP -->|"owner/repo#N"| GHO
    DISP -->|"Jira key, no adapter"| UNAV
    DISP -. "#849" .-> JIRA
    GHO --> TC
    UNAV --> EV
```

## Legend

- **Consumers:** the six construction sites that today build a GitHub label reader or a
  `GhRunner`-backed blocker resolver directly. After this change each one builds an `OrderingSource`
  and passes it to the policy layer.
- **Policy layer:** ordering, caching, outage fallback, the per-walk memo, and cycle detection stay
  exactly as they are. They consume normalized facts, not raw GitHub labels or `blocked_by` JSON.
- **OrderingSource (new):** the only path to ordering facts. It returns normalized values: a
  `PriorityBand`, an `S`/`M`/`L` size, and blockers as canonical source-ref strings. It also returns
  two non-fact outcomes: `not-found`, and `unavailable` when the backend has no adapter.
- **Dispatch:** chooses a backend per reference from its parsed `WorkRef` kind. GitHub references go
  to the GitHub implementation. A Jira key goes to `unavailable`, which emits
  `tracker_backend_unavailable` instead of being silently treated as not found.
- **Dashed edge:** deferred integration. #849 registers the Jira implementation behind the same port.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-10 | Initial generation | #851 DECIDE: backend-neutral ordering reads |
| 2026-10-10 | Added the monitor-cli consumer | #851 plan: sixth construction site found |
| 2026-10-10 | Added the daemon-ordering-readers helper | #851 plan Task 8: one shared source per daemon run |
