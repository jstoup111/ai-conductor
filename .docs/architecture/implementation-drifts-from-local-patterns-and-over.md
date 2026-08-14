# Component Flow: Feature-Specific Pattern Reuse and Test Selection

**Last updated:** 2026-08-13  
**Scope:** The existing DECIDE and BUILD skills affected by issue #1552; no new runtime component, parser, manifest, or engine gate.

## Diagram

```mermaid
flowchart LR
    subgraph decide["DECIDE — judgment and durable context"]
        ADR["Approved ADRs<br/>authoritative"]
        HEAD["Current HEAD<br/>nearby implementation"]
        AR["architecture-review<br/>identify semantic traits and search hints"]
        BASIS["Feature pattern basis<br/>role · traits · hints · rationale · allowed variation"]
        NOBASIS["No applicable pattern<br/>or bounded departure rationale"]
        PLAN["plan<br/>carry focused basis into relevant tasks"]

        ADR --> AR
        HEAD --> AR
        AR -->|"applicable exemplar"| BASIS
        AR -->|"no current equivalent"| NOBASIS
        BASIS --> PLAN
        NOBASIS --> PLAN
    end

    subgraph build["BUILD — resolve against the checkout being changed"]
        PIPE["pipeline<br/>send task plus focused basis"]
        GEN["generator and TDD<br/>re-discover equivalent on current HEAD"]
        STALE["Stale basis<br/>surface instead of guessing"]
        CHANGE["Smallest pattern-conforming change"]
        REVIEW["evaluator, code review, and simplify<br/>check intended reuse without enforcing global style"]

        PIPE --> GEN
        GEN -->|"equivalent missing"| STALE
        GEN -->|"equivalent found"| CHANGE
        CHANGE --> REVIEW
    end

    subgraph tests["Lowest sufficient test layer"]
        STORIES["Story criteria<br/>happy and negative behavior"]
        CLASSIFY["writing-system-tests<br/>classify coverage"]
        LOWER["Unit or request test<br/>single behavior"]
        ACCEPT["Acceptance or system test<br/>distinct multi-step observable flow"]
        EXISTING["Already covered<br/>cite existing behavioral test"]

        STORIES --> CLASSIFY
        CLASSIFY --> LOWER
        CLASSIFY --> ACCEPT
        CLASSIFY --> EXISTING
    end

    PLAN --> PIPE
    LOWER --> PIPE
    ACCEPT --> PIPE
    EXISTING --> PIPE
```

## Legend

- Exemplar paths and symbols are search hints. Line numbers are never part of the pattern basis.
- BUILD resolves the semantic traits against its current checkout; it does not copy an authoring-time snapshot.
- Approved ADRs outrank observed code. Code that conflicts with an approved decision is not precedent.
- The existing exact-copy `Pattern-source` / `Rename-map` flow remains governed by `adr-2026-08-09-declared-pattern-replication-in-build` and is unchanged.
- Test coverage follows behavior rather than production-file count or skill wording.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-13 | Initial design flow | DECIDE for issue #1552 |
| 2026-08-13 | Added the planned code-review consumer | Plan update for the complete non-`build_review` review path |
