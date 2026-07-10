# Sequence: merged-PR guard intercepts the #358 race

**Last updated:** 2026-07-09
**Scope:** The out-of-band-merge race and how the guard exits the retry cleanly at both
insertion points.

## Diagram

```mermaid
sequenceDiagram
    participant OP as Operator
    participant D as Daemon step loop
    participant G as MergedPrGuard
    participant GH as gh CLI
    participant L as Ledger and shipped record

    Note over D: finish fails completion check try 1
    D->>D: planRemediation routes back to build
    OP->>GH: manually retitles and merges PR «N»
    D->>G: kickback re-entry guard on state.pr_url
    G->>GH: pr view «url» json state
    GH-->>G: state MERGED
    G->>L: writeShippedRecord + markProcessed
    G-->>D: already shipped out-of-band
    D->>D: stop cleanly, no rebuild, no rebase

    Note over D,G: backstop, merge lands mid-chain instead
    D->>G: runRebaseStep entry guard
    G->>GH: pr view «url» json state
    alt MERGED
        GH-->>G: state MERGED
        G->>L: ship side-effects then clean stop
    else OPEN, CLOSED, NOTFOUND, UNKNOWN or gh error
        GH-->>G: non-merged or error
        G-->>D: proceed with normal rebase
    end
```

## Legend

- «N» / «url» — the feature's recorded PR (`state.pr_url`).
- The guard fires at two points: kickback re-entry (earliest exit, saves the rebuild +
  audit cycle) and rebase entry (backstop for merges landing mid-chain).
- Every non-MERGED verdict — including gh failure — is advisory: the run proceeds as today.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-09 | Initial generation | DECIDE phase for issue #358 |
