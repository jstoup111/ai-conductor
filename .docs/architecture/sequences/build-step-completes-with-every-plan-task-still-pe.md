# Sequence: A plan task whose text changed is reopened before BUILD completes

**Last updated:** 2026-10-02
**Scope:** BUILD entry after the plan's task text has changed since the tasks were seeded (an operator amendment, typically followed by `rewind --to build`), and the BUILD completion reason when tasks remain unresolved. Logical sequence for architecture review; storage shape is owned by `adr-2026-09-06-reopened-task-resolution`.

## Diagram

```mermaid
sequenceDiagram
    participant P as Plan file
    participant Seed as Task seeding
    participant S as Durable engine state
    participant O as Repair obligation store
    participant R as Shared resolver
    participant B as BUILD dispatch
    participant C as BUILD completion predicate
    Seed->>P: Read each plan task's current text
    Seed->>S: Read recorded per-task content digests for this plan
    alt No digest recorded for the plan yet
        Seed->>S: Record current digests, reopen nothing
    else Digest unchanged for a task
        Seed->>Seed: Keep existing completion evidence
    else Digest changed for a task
        Seed->>O: Admit or replay obligation keyed by task and new digest
        Note over Seed,O: Source is the plan change, not a gate. No lap is charged
        O-->>Seed: Open obligation with HEAD boundary at detection
        Seed->>S: Record the new digest after admission persists
        Seed->>Seed: Restage the task as pending
    end
    B->>B: Work the unresolved tasks with their names in the hint
    B->>C: Step session ends
    C->>R: Resolve every plan task
    R->>O: Read open obligations
    R-->>C: Trailers before the boundary do not resolve a reopened task
    alt Every plan task resolved
        C-->>B: Complete the step cleanly
    else Some tasks unresolved
        C-->>B: Not done. Reason lists every pending task id and title
        B->>B: Existing retry and no-progress bounds apply
    end
```

## Legend

The digest is taken over a task's normalized plan text (heading and body), so whitespace-only edits do not reopen work. A plan with no recorded digests, such as a feature already in flight when this ships, records a baseline and reopens nothing. A reopened task can still close without a new commit through the existing engine-accepted task-close evidence (`adr-2026-09-06-reopened-task-resolution` D4), so a cosmetic wording fix does not force rework. The completion reason is the same text used by the step retry, the build stall question, and the HALT.

## Change Log

| Date | Change | Reason |
| --- | --- | --- |
| 2026-10-02 | Initial sequence | #2014: stale `Task:` trailers resolved rewritten plan tasks and let BUILD complete with every task pending |
