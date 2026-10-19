# Sequence: build_review remediate context scoped to the findings

**Last updated:** 2026-10-19
**Scope:** Proposed flow for #3291. The post-join `remediate` judgement receives full plan-task
bodies only for the tasks its findings and open cases touch, plus an index of every plan task.
The engine allows admission only to tasks whose body was supplied, and runs at most one
expansion re-dispatch when the judge names a task it saw only in the index. The engine checks
the serialized context against a ceiling the dispatching transport can deliver. An over-limit
context or a failed dispatch halts with a named, operator-readable reason. Prior-case history
stays complete (adr-2026-09-10-portable-build-review-policy). There is no new process, store,
persisted schema, or CLI surface. The flow extends the adjudication coordinator, the context
assembler, the case validator, and the conductor's judge dispatch.

## Diagram

```mermaid
sequenceDiagram
  participant Coord as Adjudication coordinator
  participant Sel as Task selection
  participant Ctx as Context assembler
  participant Judge as remediate judge dispatch
  participant Prov as Provider transport
  participant Val as Case validator
  participant Op as Operator

  Coord->>Sel: plan, current findings, open cases, work order
  Note over Sel: selected = pointer tasks + open-case admitted ids + tasks whose declared files overlap finding evidence
  Sel-->>Coord: selected task bodies, index of every task as id, title, dependencies
  Coord->>Ctx: assemble with selected bodies, index, ALL prior cases
  Ctx->>Ctx: bound fields, measure serialized bytes against the transport ceiling
  alt over the ceiling
    Ctx-->>Coord: serialized-byte-overflow stop naming actual and limit
    Coord-->>Op: halt naming the stop
  else within the ceiling
    Coord->>Judge: dispatch context
    Judge->>Prov: system prompt via file or stdin
    alt dispatch fails
      Prov-->>Judge: exit facts such as processErrorCode
      Judge-->>Coord: failure carrying exit facts
      Coord-->>Op: halt naming the provider and exit facts
    else judgement written
      Judge-->>Coord: case judgement
      Coord->>Val: validate, admitted ids must be among supplied bodies
      alt admission names an index-only task, first round
        Val-->>Coord: index-only task ids
        Coord->>Ctx: reassemble adding those bodies
        Coord->>Judge: one expansion re-dispatch
        Judge-->>Coord: case judgement
        Coord->>Val: validate again
      end
      alt still names an index-only task
        Val-->>Coord: admission-closure stop naming task ids
        Coord-->>Op: halt naming the unsupplied task ids
      else valid
        Val-->>Coord: graph ok
        Coord->>Coord: reconcile, reserve and apply effects as today
      end
    end
  end
```

## Legend

- **Task selection** is new engine logic inside the coordinator boundary. It is deterministic and
  makes no LLM call.
- **Index** lists every active plan task by id, title, and declared dependencies, with no body.
  The judge can cite an index-only task, but cannot admit work against one without the expansion
  round.
- **Transport ceiling** is the byte limit the dispatching provider transport declares it can
  deliver. The existing `serialized-byte-overflow` stop reports it.
- The **expansion round** is bounded to one re-dispatch per lap. Every other step after
  validation (reconcile, effects, work order, kickback charge) is unchanged.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-19 | Initial generation | #3291: remediate context scales with the plan, not the findings |
