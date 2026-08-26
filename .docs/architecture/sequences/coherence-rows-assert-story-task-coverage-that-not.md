# Sequence: A criterion coverage claim from authoring to land verdict

**Last updated:** 2026-08-23
**Scope:** How the three defects in jstoup111/ai-conductor#1799 are each caught at DECIDE —
an unsupported coverage claim, an unowned accepted criterion, and a criterion pinned to state
outside the feature's own diff — instead of surfacing as a needs-human halt at `acceptance_specs`.

## Diagram

```mermaid
sequenceDiagram
    participant OP as Operator
    participant ENG as Engineer session (skills)
    participant WT as Per-idea worktree .docs/
    participant LAND as engineer land (deterministic)
    participant BUILD as BUILD acceptance_specs

    Note over ENG,WT: /stories then /plan already accepted
    ENG->>WT: read .docs/stories/«stem».md for accepted criteria
    ENG->>WT: NEW /coherence-check authors one criterion row per criterion:<br/>cited task id(s), verbatim quote from that task, diff-locality disposition

    OP->>LAND: conduct-ts engineer land
    LAND->>WT: existing ladder (guards, C2, DRAFT-ADR, tier, ids)
    LAND->>WT: NEW resolveRequiredLayers engages criterion layer<br/>(signal-gated — tier S and legacy change sets stay exempt)
    LAND->>WT: NEW re-enumerate criteria and diff against criterion rows

    alt a criterion has no row
        LAND-->>OP: reject: omitted criterion named,<br/>gap id criterion-«n» (waivable)
        OP->>ENG: assign it to a task, or waive deliberately
    else a row cites a task whose text does not contain its quote
        LAND-->>OP: reject: names the criterion AND the task it was attributed to
        OP->>ENG: fix the plan task or the claim
    else a row's diff-locality disposition is absent or negative
        LAND-->>OP: reject: criterion pinned to state outside this diff
        OP->>ENG: restate the criterion against the feature's own diff
    else every criterion owned, grounded, and diff-local
        LAND->>WT: commit .docs on spec/«slug» branch
        LAND-->>OP: land OK, no added ceremony
        Note over BUILD: coverage gap can no longer reach here
    end

    opt a gap still escapes to BUILD
        BUILD-->>OP: halt names the DECIDE-time check that should have caught it
    end
```

## Legend

- `«…»` — variable placeholder (plan stem, criterion index, slug).
- "NEW" marks steps introduced by this feature.
- The three `alt` branches are the issue's three named defects, in the order the issue states them.
- The quote-grounding branch is how a judgement claim is made falsifiable without running a model
  at land: the author judges *which* task carries the criterion, the engine mechanically verifies
  the quote it relied on is really in that task's text.
- The skill enumerates criteria by reading the stories file — no dedicated CLI primitive. Authoring
  completeness is not trusted: the land rung re-enumerates with the engine extractor, so a missed
  criterion is rejected by name rather than passing silently.
- The final `opt` covers the issue's last desired outcome — a late-discovered gap must name its
  upstream check rather than reporting a bare coverage failure.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-23 | Initial generation | DECIDE-phase design for intake #1799 |
| 2026-08-23 | Verified against the 24-task plan; no structural change | Plan-update pass (/plan step 8b) |
