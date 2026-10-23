# Sequence: build_review remediate context scoped to the findings

**Last updated:** 2026-10-23
**Scope:** Proposed flow for #3291. The post-join `remediate` judgement receives full plan-task
bodies only for the tasks its findings and open cases touch, plus an index of every plan task.
The existing admission check accepts only supplied task ids. When a case-v2 judgement fails only
because it admits index-only tasks, the coordinator discards it and re-dispatches the same
judgement once with those bodies added. The existing serialized-byte ceiling still applies to
every round. A failed dispatch halts with the provider's bounded exit facts. Prior-case history
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
  participant Prov as Provider
  participant Val as Case validator
  participant Op as Operator

  Coord->>Sel: plan, current findings, open cases
  Note over Sel: bodies = tasks whose declared files hold a finding's evidence path + pointer tasks + open-case admitted ids
  Sel-->>Coord: selected task bodies, index of every task as id, title, dependencies
  Coord->>Ctx: assemble with selected bodies, index, ALL prior cases
  Ctx->>Ctx: bound fields, measure serialized bytes against the existing ceiling
  alt over the ceiling
    Ctx-->>Coord: serialized-byte-overflow stop naming actual and limit
    Coord-->>Op: halt naming the stop
  else within the ceiling
    Coord->>Judge: dispatch context (round 1)
    Judge->>Prov: prompt over stdin
    alt dispatch fails
      Prov-->>Judge: bounded exit facts such as processErrorCode
      Judge-->>Coord: failure carrying exit facts
      Coord-->>Op: halt naming the provider and exit facts
    else judgement written
      Judge-->>Coord: case judgement
      Coord->>Val: validate, admitted ids must be among supplied bodies
      alt case-v2, only failure is index-only admitted ids, round 1
        Val-->>Coord: unknown-admission-task naming index-only ids
        Coord->>Coord: discard round-1 judgement
        Coord->>Ctx: reassemble adding those bodies, same ceiling
        Coord->>Judge: dispatch context (round 2, the only expansion)
        Judge-->>Coord: case judgement
        Coord->>Val: validate again
      end
      alt still invalid
        Val-->>Coord: rejection, naming any unsupplied task ids
        Coord-->>Op: halt naming the rejection and the unsupplied task ids
      else valid
        Val-->>Coord: graph ok
        Coord->>Coord: reconcile, reserve and apply effects as today
      end
    end
  end
```

## Legend

- **Task selection** is new engine logic inside the coordinator boundary. It is deterministic,
  reuses the existing plan parsers, and makes no LLM call.
- **Index** lists every active plan task by id, title, and declared dependencies, with no body.
  The judge can cite an index-only task, but cannot admit work against one without the expansion
  round.
- **Ceiling** is the existing `maxSerializedBytes` context limit. Every provider already delivers
  the prompt over stdin, so no per-transport ceiling is introduced.
- The **expansion round** happens at most once per lap and only for case-v2, the only mode with an
  admission contract. Round 1's judgement is discarded, never merged. Every step after validation
  (reconcile, effects, work order, kickback charge) is unchanged, and the expansion charges no
  kickback.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-19 | Initial generation | #3291: remediate context scales with the plan, not the findings |
