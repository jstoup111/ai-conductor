# Components: build_review fan-out and shared remediate fan-in

**Last updated:** 2026-08-29
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#2033: independent rubric
judgements, one mechanical raw join, one existing `remediate` judgement over current and prior
outcomes, durable case history, deterministic effects, and one effective gate decision.

## Diagram

```mermaid
graph TD
  subgraph Rubrics["Independent rubric judgement"]
    SNAP["Frozen build_review snapshot"]
    COORD["BuildReviewCoordinator<br/>capped fan-out"]
    R1["Rubric session A"]
    R2["Rubric session B"]
    RN["Rubric session N"]
  end

  subgraph Join["Engine-owned fan-in"]
    RAW["Mechanical raw join<br/>validate every branch<br/>preserve every finding"]
    RISK["Operator accepted-risk reducer<br/>existing exact disposition authority"]
    CLASSIFY["build-review-adjudication.ts<br/>content/infrastructure classifier<br/>closed effective transition"]
    CONTEXT["build-review-adjudication-context.ts<br/>current unresolved findings<br/>all prior cases or typed overflow<br/>plan contract and task status"]
    DISPATCH["Existing remediate dispatch<br/>one fresh provider session"]
    VALIDATE["remediation-case-validator.ts<br/>source-complete case-v1 result<br/>actionable, merged, deferred, rejected"]
    RECONCILE["remediation-case-reconciler.ts<br/>bind existing case or stamp new case<br/>append traces and classify repeats"]
  end

  subgraph Effects["Deterministic effect boundary"]
    RESERVE["remediation-case-effects.ts<br/>reservation under case-store lease<br/>reserved, applied, failed"]
    WORK["build-review-work-order.ts<br/>durable BUILD work and attempt evidence<br/>.pipeline/build-review-work-order.json"]
    INTAKE["TrackerClient plus fileIntakeIssue<br/>exact all-state marker lookup<br/>sanitize, create, record ref"]
    BUDGET["kickback-ledger.ts<br/>charge stable effect id once<br/>repeated attempted case halts"]
    OUTER["Effective outer verdict<br/>PASS, BUILD route, or fail-closed stop"]
  end

  subgraph State["Feature-scoped durable state"]
    BRANCH["Per-lap rubric artifacts<br/>.pipeline/build-review/«lap»/«rubric».json"]
    AGG["Raw aggregate<br/>.pipeline/build-review.json"]
    OPDISP["Operator accepted-risk state<br/>.pipeline/build-review-dispositions.json"]
    HISTORY["RemediationCaseStore<br/>.pipeline/remediation-cases.json<br/>versioned case/effect history"]
    REMPLAN["Current case-v1 remediate result<br/>.pipeline/remediation.json"]
    PLAN["Approved plan and task-status ledger"]
  end

  subgraph External["Existing external boundary"]
    GH["GitHub Issues"]
  end

  subgraph Spine["Existing telemetry spine"]
    EMIT["ConductorEventEmitter"]
    UNION["ConductorEvent union"]
    PERSIST["EventPersister"]
    EVENTS[".pipeline/events.jsonl"]
  end

  SNAP --> COORD
  COORD --> R1
  COORD --> R2
  COORD --> RN
  R1 --> BRANCH
  R2 --> BRANCH
  RN --> BRANCH
  BRANCH --> RAW
  RAW --> AGG
  OPDISP --> RISK
  RAW --> RISK
  RISK --> CLASSIFY
  CLASSIFY -->|"all content resolved"| OUTER
  CLASSIFY -->|"infrastructure only"| OUTER
  CLASSIFY -->|"unresolved content, including mixed lap"| CONTEXT
  HISTORY --> CONTEXT
  PLAN --> CONTEXT
  CONTEXT --> DISPATCH
  DISPATCH --> REMPLAN
  REMPLAN --> VALIDATE
  VALIDATE --> RECONCILE
  HISTORY --> RECONCILE
  RECONCILE --> RESERVE
  RESERVE --> HISTORY
  RESERVE --> WORK
  RESERVE --> INTAKE
  INTAKE --> GH
  GH --> INTAKE
  WORK --> BUDGET
  INTAKE --> BUDGET
  BUDGET --> OUTER

  COORD --> EMIT
  RAW --> EMIT
  DISPATCH --> EMIT
  VALIDATE --> EMIT
  RESERVE --> EMIT
  OUTER --> EMIT
  EMIT --> UNION
  UNION --> PERSIST
  PERSIST --> EVENTS

  classDef existing fill:#e8f1ff,stroke:#3367a8;
  classDef changed fill:#dff5e1,stroke:#2f7d3c,stroke-width:2px;
  classDef newstate fill:#fff3e0,stroke:#ef6c00,stroke-width:2px;
  class SNAP,COORD,R1,R2,RN,RAW,RISK,BRANCH,AGG,OPDISP,REMPLAN,PLAN,GH,EMIT,UNION,PERSIST,EVENTS existing;
  class CLASSIFY,CONTEXT,DISPATCH,VALIDATE,RECONCILE,RESERVE,WORK,INTAKE,BUDGET,OUTER changed;
  class HISTORY newstate;
```

## Boundary decisions shown

- Rubrics remain independent and never receive sibling findings, prior adjudication history, or
  operator dispositions. Their write-disjoint artifacts remain raw evidence.
- The raw join is mechanical and source-preserving. A below-allowance infrastructure fault keeps the
  existing non-publishing lane. At exhaustion, the aggregate may publish for the existing operator
  reduced-coverage decision; content cannot continue until every infrastructure branch is exactly
  covered. The join never deduplicates semantic substance, assigns repair priority, files issues, or
  spends a semantic kickback allowance.

> **Amended 2026-08-29 by #2033:** the non-publishing rule applies to infrastructure-only laps. A
> mixed lap publishes current content and infrastructure together, sends only content to one
> `remediate` judgement, and retains infrastructure as an independent blocker. Exact operator reduced
> coverage remains the only non-healing path by which infrastructure can permit PASS.

- Existing operator risk acceptance is applied before autonomous synthesis and retains its separate
  authority. Autonomous `remediate` outcomes never become operator dispositions.
- One existing `remediate` dispatch receives every current unresolved content finding together with
  every feature-local prior case in a structurally and byte-bounded context, plus mechanically
  derived resolution evidence. It does not re-audit the source tree. Overflow fails closed rather
  than silently dropping old cases.
- The result validator requires exactly one traceable outcome for every raw source finding. Merge
  references must resolve, contradictory routes are invalid, and an actionable outcome must carry
  dispatchable work.
- Engine machinery stamps durable case identities, reserves external effects, publishes a durable
  BUILD work order or deferred intake, updates effect status, and decides budget/routing. The work
  order is retry context only: `build_review` does not append to the approved plan. Provider output
  never performs effects directly.
- A lap with one or more newly actionable cases consumes the existing `build_review` kickback once,
  regardless of how many findings were merged into the work order. A crash-interrupted effect may
  resume by its stable effect id without another charge. Once BUILD attempted the case, an equivalent
  unresolved finding halts with the prior case evidence instead of receiving a free route or being
  charged again.
- A mixed lap gives an admitted actionable content route precedence over the infrastructure retry for
  that transition. With no actionable content route, the uncovered infrastructure result follows its
  existing retry or exhaustion path. It can never be converted to PASS by case state.
- Any incomplete judgement, invalid result, unreadable history, or unapplied required effect is
  fail-closed and cannot publish PASS.

## Event-spine verdict

```text
Event spine
  Channel?    yes — adjudication start, completion, failure, and effect outcomes are occurrences
  Concern:    occurrence for lifecycle events; durable state for cases and current verdicts
  Verdict:    extend the ConductorEvent union; no bespoke telemetry format or reader
  Exception:  C for autonomous adjudication history and effect status
```

The autonomous history answers what is true about each adjudicated case now, including its source
finding references, outcome, effect reference, and resolution status. It is durable control state,
not an audit log reconstructed from timestamps. Every occurrence emitted while producing or
applying that state uses the existing event union and persister.

## Legend

- Blue nodes are existing components or artifacts reused by the design.
- Green nodes are changed control boundaries.
- Orange is new durable state, deliberately separate from operator accepted-risk authority.
- `«lap»` and `«rubric»` are runtime identifiers.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-29 | Initial proposed component diagram | DECIDE architecture input for issue #2033 |
| 2026-08-29 | Preserve content adjudication on mixed mechanical/content laps | Conflict-check resolution preserves the established mixed-lap contract |
| 2026-08-29 | Name planned modules and durable artifacts | Plan-update pass binds implementation tasks to architecture seams |
