# Components: live remediation state is owned and open by construction

**Last updated:** 2026-11-15
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#3658. The four remediation
inputs a BUILD session can reach — the build-review work order, the case judgement, the typed gap
plan, and the captured stall question — move from the feature-level `.pipeline/` directory into the owning child's region, and
leave the live path once nothing open depends on them. The BUILD stall seam checks a cited case
against the case stores before it asks for a remediation plan. No new module layer, service,
dependency, CLI command, or settings key is added.

## Diagram

```mermaid
graph TD
  subgraph Region["Per-child region: .pipeline/children/«k»/"]
    CASES["remediation-cases.json<br/>(already per-child)<br/>authority for open vs settled"]
    ORDER["build-review-work-order.json<br/>moves here from .pipeline/"]
    JUDGE["remediation.json<br/>relocated here by the engine<br/>after it parses the judgement"]
    PLAN["remediation-plan.json<br/>moves here from .pipeline/"]
    STALLQ["build-stall-question.md<br/>moves here from .pipeline/"]
  end

  subgraph Paths["Path seam"]
    PATHFOR["child-context.ts pipelinePathFor<br/>no child: flat .pipeline path<br/>child: children/«k» path"]
    ADOPT["legacy adoption (new)<br/>a flat artifact left by an older engine<br/>is moved to the child whose store owns<br/>its cases, else retired"]
  end

  subgraph Lifecycle["Engine-owned lifecycle"]
    OUTBOX["remediation-case-store.ts<br/>outbox drain: single chokepoint<br/>for every resolved transition"]
    RETIRE["artifact retirement (new)<br/>removes the work order and judgement<br/>when the region has no open case;<br/>the gap plan when its routed BUILD passes<br/>or its stall halts; the stall question<br/>when its stall is routed or halted"]
    CONTEXT["conductor.ts<br/>durableBuildReviewRetryContext<br/>reads the active child's order only;<br/>names the judgement and gap plan paths"]
  end

  subgraph Stall["BUILD stall seam"]
    MARKER[".pipeline/halt-user-input-required<br/>written by the BUILD session"]
    CHECK["stale-citation check (new)<br/>cited case id looked up in<br/>every child's case store"]
    REMEDIATE["planRemediation<br/>existing stall remediation"]
    REDISPATCH["BUILD re-dispatch<br/>bounded, counted on the event spine"]
    HALT["writeHaltMarker<br/>cap exhausted"]
  end

  BUILD["BUILD session for child «k»"]

  PATHFOR --> ORDER
  PATHFOR --> JUDGE
  PATHFOR --> PLAN
  PATHFOR --> STALLQ
  ADOPT --> PATHFOR
  OUTBOX -->|case settled| RETIRE
  RETIRE -->|remove| ORDER
  RETIRE -->|remove| JUDGE
  RETIRE -->|remove| PLAN
  RETIRE -->|remove| STALLQ
  CASES --> OUTBOX
  CASES --> CONTEXT
  ORDER --> CONTEXT
  CONTEXT -->|open owned case only| BUILD
  BUILD --> MARKER
  MARKER --> STALLQ
  MARKER --> CHECK
  CASES --> CHECK
  CHECK -->|open and owned, or no case cited| REMEDIATE
  CHECK -->|settled or another child's| REDISPATCH
  REDISPATCH -->|under cap| BUILD
  REDISPATCH -->|cap exhausted| HALT
```

## Sequence: a stall that cites a settled or foreign case

```mermaid
sequenceDiagram
  participant B as BUILD session (child 3)
  participant C as Conductor stall seam
  participant S as Case stores (all children)
  participant E as Event spine
  participant R as Stall remediation

  B->>C: writes halt-user-input-required citing case «id»
  C->>S: look up case «id»
  alt case is open in child 3
    S-->>C: open and owned
    C->>R: plan remediation (unchanged path)
  else case is settled, or open in another child
    S-->>C: settled or foreign
    C->>E: record stale citation (counted)
    alt count is under the cap
      C->>B: clear marker and re-dispatch BUILD with the finding
    else cap exhausted
      C->>E: loop halt
      Note over C: HALT written with a class the existing halt-clear path accepts
    end
  else no case id cited, or id unknown to every store
    C->>R: plan remediation (unchanged path)
  end
```

## Legend

- **Per-child region**: state one child's BUILD owns. A whole-feature run with no child keeps the
  flat `.pipeline/` path through the same seam, and the same retirement applies.
- **Path seam**: the existing child-path helper. Legacy adoption is the only compatibility read;
  it runs for features an older engine left mid-remediation.
- **Engine-owned lifecycle**: the case store stays the authority. Retirement removes files; the
  case records and the event log remain the durable record of what happened.
- **BUILD stall seam**: the stale-citation check sits after the engine reads the stall question and
  before it clears the marker or dispatches remediation.
- **(new)**: behaviour this spec adds inside existing modules.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-15 | Initial generation | Proposed design for jstoup111/ai-conductor#3658 |
| 2026-11-15 | Added the stall question as a fourth region input; gap plan kept until its routed BUILD passes; prompt names the readable inputs | Conflict-check resolutions and the implementation plan |
