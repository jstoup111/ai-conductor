# Sequence: FINISH prose author→judge revision lap (issue #2006)

**Last updated:** 2026-08-28
**Scope:** one FINISH dispatch encountering authored PR prose the judge finds deficient —
before (deadlock) and after (bounded revision lap).

## Diagram — after the fix

```mermaid
sequenceDiagram
    participant C as FINISH coordinator
    participant O as Observation
    participant S as Selector
    participant J as Judge effect
    participant A as Authoring effect
    participant P as prose-judgment.json

    C->>O: observe PR «url»
    O->>P: verdict for revision digest «d1»?
    P-->>O: revision_required (structurally_incomplete, detail)
    O-->>C: pr.prose = revision_required
    C->>S: nextFinishPublicationTransition
    S-->>C: author_pr_prose
    C->>A: author, carrying judge detail
    A-->>C: body rewritten → revision «d2»
    C->>O: re-observe
    O->>P: verdict for «d2»?
    P-->>O: none
    O-->>C: pr.prose = stale
    C->>S: nextFinishPublicationTransition
    S-->>C: judge_pr_prose
    C->>J: judge revision «d2»
    alt judge accepts
        J->>P: persist accepted «d2»
        J-->>C: advanced — publication continues
    else judge rejects again
        J->>P: persist revision_required «d2»
        J-->>C: retry author_pr_prose
        Note over C: publication-progress allowance decrements —<br/>non-converging laps halt with the verdict detail
    end
```

## Legend

- «d1», «d2» — sha256 digests of the observed title/body revision; the persisted-verdict key.
- The pre-fix deadlock: observation had no `revision_required` state, so the selector said
  `judge_pr_prose` while the judgment's retry said `author_pr_prose`, and
  `reconcileSelectablePublicationRetry` halted `publication_transition_unmoved` forever at
  zero provider cost (cached verdict).
- The reconcile guard still halts when a transition genuinely leaves its state unchanged —
  e.g. an authoring pass that produces the identical revision.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-28 | Initial generation | DECIDE for issue #2006 (spec authoring) |
