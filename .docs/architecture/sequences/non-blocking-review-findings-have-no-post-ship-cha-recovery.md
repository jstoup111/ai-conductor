# Sequence: Recover historical actions

**Last updated:** 2026-09-30
**Scope:** Tasks 17–19: retained modern snapshots and exact supported legacy evidence.
**Validation:** Logical flows and plan updates approved by the operator 2026-09-30.

## Diagram

```mermaid
sequenceDiagram
  actor Operator
  participant Recover as actions recover
  participant Evidence as Retained feature and shipped sources
  participant Import as Exact source importer
  participant Store as Repository action store
  participant Bus as Existing event spine
  Operator->>Recover: Recover selected feature or repository scope
  Recover->>Evidence: Read modern snapshots or supported structured legacy records
  loop Independent retained sources within bounds
    alt Valid outstanding non-blocking concern
      Recover->>Import: Validated source identity and provenance
      Import->>Store: Reconcile exact links under short mutation lease
      Store-->>Recover: Existing resolution preserved or new open action
    else Explicitly repaired, refuted or dismissed
      Recover->>Import: Retain prior outcome without open work
    else Missing, malformed, conflicting or oversized source
      Recover->>Recover: Name incomplete source, continue valid siblings
    end
  end
  Recover->>Bus: Emit persisted recovery result and named gaps
  Recover-->>Operator: Recovered actions and explicit partial result
  Note over Recover,Store: Replay preserves resolutions and existing issue links
  Note over Recover,Evidence: No reviewer dispatch, BUILD or invented evidence
```

## Legend

Risk acceptance permits shipping but does not prove follow-up completion. Modern snapshots carry
source identity; legacy recovery uses only the approved typed/structured parsers and digest namespace,
never fuzzy prose matching. An older source cannot overwrite a later operator decision.

Recovery bounds are 8,000 bytes per source, 64 references, 512 source links and a 16 MiB repository
action envelope. A limit yields a named partial/refused result, never silent truncation or complete
empty success. These limits do not constrain existing live gate-control state.

[System context and flow index](../non-blocking-review-findings-have-no-post-ship-cha.md)

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-30 | Initial historical recovery flow | PRD FR-5 and FR-9 through FR-12 |
| 2026-09-30 | Bind recovery to exact parsers, partial results and approved bounds | Plan update; approved ADR |
