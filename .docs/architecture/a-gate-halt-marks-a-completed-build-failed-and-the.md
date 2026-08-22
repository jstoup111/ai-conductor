# Components: step dispatch refusal outcome and resume entry (a-gate-halt-marks-a-completed-build-failed-and-the)

**Last updated:** 2026-08-21
**Scope:** the BUILD/SHIP step dispatch seam in `src/conductor/src/engine/conductor.ts` — how a pre-dispatch refusal (protected-artifact seal, missing worktree preflight, live-boundary) is recorded, how that record drives resume entry, and how a blocked prerequisite gate is reported. Source issue jstoup111/ai-conductor#1753.

## Diagram: dispatch → outcome → state (proposed)

```mermaid
graph TD
  Loop[Gate loop: run step «name»]
  Gate[checkGate «gates.ts»]
  Pre[Pre-dispatch checks]
  Seal[verifyProtectedArtifactSeal]
  Path[Worktree path preflight]
  Live[Self-host live boundary]
  Dispatch[Provider dispatch]
  Outcome[Step outcome recorder]
  State[(conduct-state.json)]
  Halt[HALT + HALT.class]
  Events[(events.jsonl)]

  Loop --> Gate
  Gate -- "blocked: names prerequisite + its status" --> Halt
  Gate -- passed --> Pre
  Pre --> Seal
  Pre --> Path
  Pre --> Live
  Seal -- refused --> Outcome
  Path -- refused --> Outcome
  Live -- refused --> Outcome
  Pre -- admitted --> Dispatch
  Dispatch -- "success / failed" --> Outcome
  Outcome -- "done | failed (step work)" --> State
  Outcome -- "refused: prior status preserved" --> Halt
  Outcome --> Events
  Halt --> Events
```

## Diagram: resume after a cleared halt (proposed)

```mermaid
sequenceDiagram
  participant D as Daemon
  participant C as Conductor.run
  participant S as conduct-state.json
  participant G as checkGate
  participant R as resume entry

  D->>C: re-dispatch «slug» (HALT cleared)
  C->>S: read step statuses
  C->>R: findResumeIndex(state)
  R->>R: clampToRunnablePrerequisite (always, not only under verdict clamp)
  R-->>C: earliest step checkGate admits
  C->>G: checkGate(step)
  alt admitted
    G-->>C: passed
    C->>C: dispatch step
  else blocked
    G-->>C: reason: unsatisfied prerequisite «p» (status «s»)
    C->>C: write HALT naming «p» and «s»
  end
```

## Legend

- **Refused** — the step's own work never ran; an entry condition rejected the dispatch. Today this flows into the retries-exhausted path and stamps `failed`; proposed: a typed outcome that leaves the prior status (e.g. `done`) untouched and halts with the refusal reason.
- **Failed** — the dispatched work itself failed. Unchanged: stamps `failed`, blocks dependents.
- Cylinders are persisted files under `.pipeline/`.
- `«x»` marks a variable placeholder.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-21 | Initial generation | DECIDE for #1753 (approach A) |
| 2026-08-21 | Plan update: refusal event named `step_refused` (persisted); gate residual halt class `needs-human` | /plan for #1753 |
