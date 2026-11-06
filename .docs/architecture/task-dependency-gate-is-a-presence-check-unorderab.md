# Components: Strict plan dependency validation for new plans (#1393)

**Last updated:** 2026-11-05
**Scope:** Where the plan `**Dependencies:**` graph is validated: the shared parser, the engineer
`land` gate, the conduct `plan` gate, and daemon backlog eligibility, which stays unchanged.

## Diagram

```mermaid
graph TD
  subgraph Parser["plan-dependencies.ts (existing owner)"]
    PG["parsePlanDependencyGraph<br/>grammar + unknown-id violations"]
    CY["NEW: dependency cycle detection<br/>names every task id in an unorderable set"]
    SV["NEW: strict validation entry<br/>parse violations + cycles,<br/>engine-appended remediation ids exempt"]
    PG --> SV
    CY --> SV
  end

  PTP["plan-task-parse.ts<br/>parsePlanTaskBodies / resolvePlanTaskReference"] --> PG

  subgraph Authoring["Authoring-time gates (strict)"]
    LAND["engineer/land-spec.ts<br/>NEW land rung: every plan"]
    GATE["artifacts.ts GATE_ONLY_PREDICATES.plan<br/>strict only when plan is NEW in feature diff"]
    NEWQ["NEW: plan-is-new scope check<br/>absent at merge-base = new"]
    GATE --> NEWQ
  end

  SV --> LAND
  SV --> GATE

  subgraph Unchanged["Unchanged consumers"]
    SLC["plan-slices.ts validatePlanSlices"]
    PRC["plan-review-candidates.ts"]
    BL["daemon-backlog.ts eligibility<br/>planHasDependencyTree (presence)"]
  end

  PG --> SLC
  PG --> PRC
  PHT["artifacts.ts planHasDependencyTree<br/>(presence check, kept)"] --> BL
  PHT --> GATE
```

```mermaid
sequenceDiagram
  participant Author as Plan author (composer / conduct DECIDE)
  participant Gate as conduct plan gate
  participant Git as git merge-base
  participant Val as strict validation (plan-dependencies.ts)
  participant Land as engineer land
  Author->>Gate: plan step completes
  Gate->>Git: does .docs/plans/«stem».md exist at merge-base?
  alt plan absent at merge-base (new)
    Gate->>Val: validate(planText)
    Val-->>Gate: violations (bad line, unknown id, cycle ids)
    Gate-->>Author: unsatisfied, reason names task ids
  else plan already on default branch (legacy / remediation-amended)
    Gate-->>Author: presence check only (today's behavior)
  end
  Author->>Land: land spec
  Land->>Val: validate(planText) for every plan
  Val-->>Land: violations
  Land-->>Author: landGateError naming citing task, missing id, or cycle members
```

## Legend

- **NEW** nodes are introduced by this spec; all others exist today.
- "Engine-appended remediation ids" are the ids `isEngineAppendedRemediationTaskId` recognizes; they
  are appended after land and exempt from authoring-time validation, as in `plan-slices.ts`.
- Daemon backlog eligibility and plans already on the default branch keep the presence-only
  `planHasDependencyTree` check, so no merged spec is stranded.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-05 | Initial generation | #1393: dependency gate was presence-only |
