# Components: BUILD task reopen on plan text change

**Last updated:** 2026-10-02
**Scope:** Engine components touched by #2014 and how they connect. The runtime flow is in [the sequence diagram](sequences/build-step-completes-with-every-plan-task-still-pe.md).

## Diagram

```mermaid
graph TD
    Plan["Plan file (.docs/plans)"]
    Parse["plan-task-parse: planTaskDigests"]
    Digests["task-digests: taskDigests engine-state section"]
    Seed["task-seed: seedTaskStatus"]
    Store["repair-obligations: RepairObligationStore"]
    State[("engine-state.json")]
    Resolver["task-progress: resolveTaskIds"]
    Predicate["artifacts: BUILD completion predicate"]
    Conductor["conductor: retry hint, step_retry, stall, HALT"]
    Daemon["format-retry-line: bounded daemon retry line"]
    Plan --> Parse
    Parse --> Seed
    Seed --> Digests
    Digests --> State
    Seed -->|"admitOrReplay plan_amendment"| Store
    Store --> State
    Predicate --> Seed
    Predicate --> Resolver
    Resolver --> Store
    Predicate -->|"not-done reason: every pending id, then titles"| Conductor
    Conductor --> Daemon
```

## Legend

New: `planTaskDigests` and the `taskDigests` engine-state section. Changed: `seedTaskStatus` admits `plan_amendment` obligations; the BUILD predicate's not-done reason names every pending task. Unchanged: the obligation store, resolver, rebase translation and daemon line bound. `adr-2026-09-06-reopened-task-resolution` D11 governs the new admission source.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-02 | Initial component view | #2014: stale `Task:` trailers resolved rewritten plan tasks |
