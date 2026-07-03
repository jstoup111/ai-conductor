# Sequence: Daemon Issue-Priority Scheduling

**Last updated:** 2026-07-03
**Scope:** How a daemon scan orders eligible backlog items into priority bands using the
linked issue's priority label, including the fail-soft path when labels are unreadable.
Covers the discovery/ordering slice only — eligibility gates (stories approved, plan
well-formed, owner gate, processed/halted dedup) are unchanged and shown as one step.

## Diagram

```mermaid
sequenceDiagram
    participant D as Daemon loop
    participant B as Backlog discovery
    participant T as Base-branch tree
    participant P as Priority resolver
    participant GH as GitHub issues
    participant K as Eligible picker

    D->>B: scan backlog
    B->>T: list plans + read spec artifacts
    T-->>B: plans, stories, intake markers
    Note over B: existing eligibility gates run unchanged
    B->>B: items with sourceRef from intake marker

    B->>P: resolve priorities for linked items
    alt labels readable
        P->>GH: read priority labels of linked issues
        GH-->>P: high / medium / low / none
        P-->>B: band per item
    else labels unreadable - offline or API failure
        P-->>B: no bands - fall back to date order
        Note over P: warn once per outage
    end

    B->>B: order bands - no-issue, high, medium, low, unlabeled
    Note over B: chronological order kept inside each band
    B-->>D: ordered backlog
    D->>K: pick first eligible item
    K-->>D: next feature to build
    Note over D,K: ineligible items never block later ones
```

## Legend

- **Backlog discovery** — the existing merged-spec scan over the committed default-branch
  tree; this feature only changes the *order* of what it returns.
- **Priority resolver** — new ordering concern: maps each item's linked issue (if any) to a
  priority band. Items with no linked issue skip the resolver and take the top band.
- **Bands** — no-issue → high → medium → low → unlabeled; multiple priority labels on one
  issue resolve to the highest (FR-9).
- **Fail-soft** — any failure to read labels degrades that scan to today's pure
  chronological order (FR-7); it never blocks or fails a build.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-03 | Initial generation | DECIDE for issue #200 (daemon issue-priority scheduling) |
