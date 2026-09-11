# Sequence: One consistent review outcome

**Last updated:** 2026-09-10
**Plan update approved:** James Stoup, 2026-09-11
**Scope:** Proposed custom-policy integration with existing adjudication for #1986; diagram approved by operator 2026-09-10.


> **Amended 2026-09-10 by #1986:** Tasks 24–35 implement separate accepted-risk/coverage matching, complete case-v2 context and validation, decision-owner stops, and the single shared attended/daemon outcome operation. Missing coverage remains unjudged and cannot substitute for accepted findings.

## Diagram

```mermaid
sequenceDiagram
  participant R as Independent rubric branches
  participant J as Mechanical raw join
  participant O as Exact operator dispositions
  participant A as Existing shared adjudicator
  participant V as Case validation and effect boundary
  participant G as Aggregate review authority
  participant B as BUILD worker
  R->>J: Findings and infrastructure outcomes from one frozen lap
  J->>O: Complete raw evidence
  O-->>J: Content-bound risk and declaration/reason coverage without invented content
  Note over O,J: Coverage cannot suppress judged findings or make a zero-judgment lap pass
  alt Unresolved content remains
    J->>A: All current content, policy boundaries, prior cases, approved scope
    Note over J,A: Infrastructure remains separate. No content finding is hidden by a sibling fault
    A->>A: Judge overlap, contradictory repairs, and decision ownership
    A->>V: Case-v2 sources, consistency, actual admitting task ids, or owner escalation
    V->>V: Validate complete graph, admission, and effect legality
    V->>O: Re-read current exact operator decisions under application lease
    Note over V,G: Any blocked consistency, escalation, or invalid graph prevents all action effects
    V->>G: Durable admissible outcomes or validation failure
  else No unresolved content
    J->>G: Existing coverage state and recorded dispositions
  end
  Note over G,B: Attended and daemon consume one recorded outcome, no second adjudication
  alt Authorized within-scope repair
    G->>B: Existing bounded durable work order
    B-->>G: Attempt evidence and repaired implementation
    G->>G: Reopen invalidated tests and reviews
  else Decision gap or unresolved contradiction
    G-->>G: Route to decision owner or stop for operator
  else No remaining blocker
    G-->>G: Settle review successfully
  end
```

## Legend

The adjudicator supplies schema-constrained semantic judgment. The engine checks source completeness and authorizes effects; it does not derive semantic equivalence from finding text. Operator accepted risk remains a separate authority. Policy loading and infrastructure cannot become successful coverage through autonomous semantic disposition. No rubric or adjudicator directly appends a plan task.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-10 | Initial aggregate sequence | Preserve one authority and expose contradictory-policy handling |
| 2026-09-10 | Plan-update: concrete candidate, authority, and recovery boundaries | Reflect the approved architecture and 40-task implementation plan |
