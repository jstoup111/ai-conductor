# Sequence: Shared coherence parsing at land and dispatch

**Last updated:** 2026-08-26
**Scope:** How one coherence-artifact parser (`parseCoherenceArtifact` in
`coherence-validator.ts`) becomes the single reader for both `engineer land` and daemon
dispatch discovery, replacing daemon-backlog's bespoke `hasCoherenceTableDataRow` triple-scan,
and how a structural parse rejection carries line-level detail to both surfaces.

## Diagram

```mermaid
sequenceDiagram
    participant Land as engineer land (coherence gate)
    participant Parser as parseCoherenceArtifact (coherence-validator.ts)
    participant Disc as discoverBacklog (daemon-backlog.ts)
    participant Log as daemon log / status

    Note over Parser: Single acceptance set — ragged shape accepted, header width ignored

    Land->>Parser: parse .docs/coherence/«plan-stem».md
    alt structural defect
        Parser-->>Land: not-ok + reason with line number and mismatch detail
        Land-->>Land: reject spec on the feature branch (cheap to fix)
    else parses
        Parser-->>Land: typed rows
        Land-->>Land: deep coverage / claim validation, then land
    end

    Note over Disc: hasCoherenceTableDataRow is DELETED — discovery calls the same parser

    Disc->>Parser: parse merged .docs/coherence/«plan-stem».md (tier M or L)
    alt file absent, empty, or table-less
        Parser-->>Disc: not-ok (missing / empty / unparseable + line detail)
        Disc->>Log: skip «slug» — names the specific structural defect (fail-closed)
    else parses
        Parser-->>Disc: typed rows
        Disc-->>Disc: spec eligible for dispatch
    end
```

## Legend

- **Land** — `engineer land`'s coherence gate, already a `parseCoherenceArtifact` caller.
- **Disc** — dispatch-time backlog discovery; after this change it consumes the shared parser
  instead of its own width-equality triple-scan, so land-accepted ⇒ dispatch-parseable by
  construction.
- «plan-stem» / «slug» — the feature's plan filename stem.
- The parser's failure result gains structural detail (offending line, expected vs actual
  cell count / row class) consumed verbatim by both rejection surfaces.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1881 — unify the two divergent coherence readers |
